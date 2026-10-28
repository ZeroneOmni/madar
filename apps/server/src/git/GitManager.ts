import {
  type GitCommandError,
  type VcsCreateWorktreeInput,
  type VcsCreateWorktreeResult,
  type VcsStatusInput,
  type VcsStatusLocalResult,
  type VcsStatusRemoteResult,
  type VcsStatusResult,
} from "@t3tools/contracts";
import { mergeGitStatusParts } from "@t3tools/shared/git";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export type GitRemoteStatusOptions = GitVcsDriver.GitRemoteStatusOptions;

export class GitManager extends Context.Service<
  GitManager,
  {
    readonly createWorktree: (
      input: VcsCreateWorktreeInput,
      options?: GitVcsDriver.CreateWorktreeOptions,
    ) => Effect.Effect<VcsCreateWorktreeResult, GitCommandError>;
    readonly localStatus: (
      input: VcsStatusInput,
    ) => Effect.Effect<VcsStatusLocalResult, GitCommandError>;
    readonly remoteStatus: (
      input: VcsStatusInput,
      options?: GitRemoteStatusOptions,
    ) => Effect.Effect<VcsStatusRemoteResult | null, GitCommandError>;
    readonly status: (input: VcsStatusInput) => Effect.Effect<VcsStatusResult, GitCommandError>;
    readonly invalidateLocalStatus: (cwd: string) => Effect.Effect<void>;
    readonly invalidateRemoteStatus: (cwd: string) => Effect.Effect<void>;
    readonly invalidateStatus: (cwd: string) => Effect.Effect<void>;
  }
>()("t3/git/GitManager") {}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const cacheKey = (cwd: string) => fs.realPath(cwd).pipe(Effect.orElseSucceed(() => cwd));
  const cacheOptions = {
    capacity: 2048,
    timeToLive: (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isSuccess(exit) ? Duration.seconds(1) : Duration.zero,
  };
  const readLocalStatus = Effect.fn("GitManager.readLocalStatus")(function* (cwd: string) {
    const details = yield* git.statusDetailsLocal(cwd, {
      includeDivergence: false,
      includeBranchChanges: true,
    });
    return {
      isRepo: details.isRepo,
      hasPrimaryRemote: details.hasOriginRemote,
      isDefaultRef: details.isDefaultBranch,
      refName: details.branch,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges,
      workingTree: details.workingTree,
      ...(details.branchChanges ? { branchChanges: details.branchChanges } : {}),
    } satisfies VcsStatusLocalResult;
  });
  const readRemoteStatus = Effect.fn("GitManager.readRemoteStatus")(function* (
    cwd: string,
    options?: GitRemoteStatusOptions,
  ) {
    const details = yield* git.statusDetailsRemote(cwd, options);
    if (!details.isRepo) return null;
    return {
      hasUpstream: details.hasUpstream,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      aheadOfDefaultCount: details.aheadOfDefaultCount,
      pr: null,
    } satisfies VcsStatusRemoteResult;
  });
  const localCache = yield* Cache.makeWith(readLocalStatus, cacheOptions);
  const remoteCache = yield* Cache.makeWith((cwd: string) => readRemoteStatus(cwd), cacheOptions);
  const localStatus: GitManager["Service"]["localStatus"] = Effect.fn("GitManager.localStatus")(
    function* ({ cwd }) {
      return yield* Cache.get(localCache, yield* cacheKey(cwd));
    },
  );
  const remoteStatus: GitManager["Service"]["remoteStatus"] = Effect.fn("GitManager.remoteStatus")(
    function* ({ cwd }, options) {
      const key = yield* cacheKey(cwd);
      return yield* options?.refreshUpstream === false
        ? readRemoteStatus(key, options)
        : Cache.get(remoteCache, key);
    },
  );
  const invalidateLocalStatus = Effect.fn("GitManager.invalidateLocalStatus")(function* (
    cwd: string,
  ) {
    yield* Cache.invalidate(localCache, yield* cacheKey(cwd));
  });
  const invalidateRemoteStatus = Effect.fn("GitManager.invalidateRemoteStatus")(function* (
    cwd: string,
  ) {
    yield* Cache.invalidate(remoteCache, yield* cacheKey(cwd));
  });
  return GitManager.of({
    createWorktree: Effect.fn("GitManager.createWorktree")(function* (input, options) {
      const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
      const project = yield* projects.findActiveByWorkspaceRoot(input.cwd).pipe(
        Effect.map(Option.getOrNull),
        Effect.orElseSucceed(() => null),
      );
      const scoped = resolveProjectSettings(settings, project?.projectId ?? null).settings;
      return yield* git.createWorktree(input, {
        worktreesDirectory: settings.worktreesDirectory,
        ...options,
        submodules:
          options?.submodules !== undefined ? options.submodules : scoped.worktreeSubmodules,
      });
    }),
    localStatus,
    remoteStatus,
    status: Effect.fn("GitManager.status")(function* (input) {
      const [local, remote] = yield* Effect.all([localStatus(input), remoteStatus(input)], {
        concurrency: "unbounded",
      });
      return mergeGitStatusParts(local, remote);
    }),
    invalidateLocalStatus,
    invalidateRemoteStatus,
    invalidateStatus: Effect.fn("GitManager.invalidateStatus")(function* (cwd) {
      yield* invalidateLocalStatus(cwd);
      yield* invalidateRemoteStatus(cwd);
    }),
  });
});

export const layer = Layer.effect(GitManager, make);
