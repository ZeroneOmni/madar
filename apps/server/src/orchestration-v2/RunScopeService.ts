import {
  type NodeId,
  type OrchestrationV2CheckpointScope,
  type ProviderThreadId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

export class RunScopeService extends Context.Service<
  RunScopeService,
  {
    readonly prepareRootRunScope: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly rootNodeId: NodeId;
      readonly providerThreadId: ProviderThreadId;
      readonly cwd: string;
      readonly createdAt: DateTime.Utc;
    }) => Effect.Effect<OrchestrationV2CheckpointScope, IdAllocator.IdAllocatorV2AllocationError>;
  }
>()("t3/orchestration-v2/RunScopeService") {}

export const layer = Layer.effect(
  RunScopeService,
  Effect.gen(function* () {
    const ids = yield* IdAllocator.IdAllocatorV2;
    return RunScopeService.of({
      prepareRootRunScope: Effect.fn("RunScopeService.prepareRootRunScope")(function* (input) {
        const id = yield* ids.allocate.checkpointScope({
          threadId: input.threadId,
          name: "root",
        });
        return {
          id,
          threadId: input.threadId,
          runId: input.runId,
          nodeId: input.rootNodeId,
          parentScopeId: null,
          providerThreadId: input.providerThreadId,
          kind: "root_run",
          ordinalWithinParent: 0,
          advancesAppRunCount: true,
          cwd: input.cwd,
          createdAt: input.createdAt,
        };
      }),
    });
  }),
);
