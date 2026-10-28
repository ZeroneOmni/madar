import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { FolderGit2Icon } from "lucide-react";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { type ThreadPullRequestBadge } from "@t3tools/client-runtime/thread-pull-requests";
import { useUiStateStore } from "../uiStateStore";
import {
  resolveThreadLastVisitedAt,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "./Sidebar.logic";
import type { SidebarThreadSummary } from "../types";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
export { type ThreadPullRequestBadge } from "@t3tools/client-runtime/thread-pull-requests";

/** Hold terminal PR metadata above rows because settlement moves remount them. */

export function ThreadWorktreeIndicator({
  thread,
}: {
  thread: Pick<SidebarThreadSummary, "id" | "branch" | "worktreePath">;
}) {
  const worktreePath = thread.worktreePath?.trim();
  if (!worktreePath) {
    return null;
  }
  const displayPath = formatWorktreePathForDisplay(worktreePath);
  const tooltip = thread.branch
    ? `Worktree: ${displayPath} (${thread.branch})`
    : `Worktree: ${displayPath}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={tooltip}
            data-testid={`thread-worktree-${thread.id}`}
            className="inline-flex items-center justify-center"
          />
        }
      >
        <FolderGit2Icon className="size-3 text-muted-foreground/40" />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
export function ThreadStatusLabel({
  status,
  compact = false,
}: {
  status: ThreadStatusPill;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={status.label}
              className={`inline-flex size-3.5 shrink-0 items-center justify-center ${status.colorClass}`}
            />
          }
        >
          <span
            className={`size-[9px] rounded-full ${status.dotClass} ${status.pulse ? "motion-safe:animate-status-pulse" : ""}`}
          />
        </TooltipTrigger>
        <TooltipPopup side="top">{status.label}</TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={status.label}
            className={`inline-flex items-center gap-1 text-3xs ${status.colorClass}`}
          />
        }
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${status.dotClass} ${status.pulse ? "motion-safe:animate-status-pulse" : ""}`}
        />
        <span className="hidden md:inline">{status.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{status.label}</TooltipPopup>
    </Tooltip>
  );
}
export function ThreadRowLeadingStatus({ thread }: { thread: SidebarThreadSummary }) {
  const ref = scopeThreadRef(thread.environmentId, thread.id);
  const visited = useUiStateStore((s) => s.threadLastVisitedAtById[scopedThreadKey(ref)]);
  const status = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, visited),
    },
  });
  return status ? <ThreadStatusLabel status={status} /> : null;
}
export function ThreadRowTrailingStatus({ thread }: { thread: SidebarThreadSummary }) {
  const environment = useEnvironment(thread.environmentId);
  const primary = usePrimaryEnvironmentId();
  if (thread.environmentId === primary) return null;
  const label = environment?.label ?? "Remote";
  const kind = resolveEnvironmentMachineKind(environment?.serverConfig ?? null);
  return (
    <Tooltip>
      <TooltipTrigger render={<span aria-label={label} />}>
        <EnvironmentMachineIcon kind={kind} className="size-3 text-muted-foreground/60" />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

// Search rows are already buttons, so this renders the sidebar badge's look without its controls.
