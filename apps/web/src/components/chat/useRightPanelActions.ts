import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { formatFilePathForClipboard } from "@t3tools/client-runtime/media-actions";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { useRightPanelStore, type RightPanelSurface } from "../../rightPanelStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import type { useDeviceState } from "../../state/device";
import { openDeviceSetupDialog } from "./ChatOverlayHosts";
import type { ChatShortcutCommands } from "./useChatShortcuts";
export function useRightPanelActions(input: {
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly activeProject: EnvironmentProject | null;
  readonly activeRightPanelSurface: RightPanelSurface | null;
  readonly deviceState: ReturnType<typeof useDeviceState>["state"];
  readonly threadPanelPresentation: ThreadPanelPresentation;
  readonly canMaximizeRightPanel: boolean;
  readonly rightPanelMaximized: boolean;
  readonly gitCwd: string | null;
  readonly activeProjectCwd: string | null;
  readonly closeRightPanelSurface: (surface: RightPanelSurface) => void;
}) {
  const { activeThreadRef } = input;
  const addFilesSurfaceStable = useStableCallback(() => {
    if (activeThreadRef && input.activeProject)
      useRightPanelStore.getState().open(activeThreadRef, "files");
  });
  const addDeviceSurfaceStable = useStableCallback(() => {
    if (!activeThreadRef) return;
    if (!input.deviceState.onboardingCompleted || input.deviceState.hostStatus === "disabled") {
      openDeviceSetupDialog(scopedThreadKey(activeThreadRef));
      return;
    }
    useRightPanelStore.getState().open(activeThreadRef, "device");
  });
  const openFileSurfaceStable = useStableCallback((relativePath: string) => {
    if (activeThreadRef && input.activeProject)
      useRightPanelStore.getState().openFile(activeThreadRef, relativePath);
  });
  const activateRightPanelSurfaceStable = useStableCallback((surface: RightPanelSurface) => {
    if (activeThreadRef) useRightPanelStore.getState().activateSurface(activeThreadRef, surface.id);
  });
  const toggleRightPanelStable = useStableCallback(() => {
    if (activeThreadRef) useRightPanelStore.getState().toggleVisibility(activeThreadRef);
  });
  const toggleThreadPanelStable = useStableCallback(() => {
    if (activeThreadRef)
      useRightPanelStore
        .getState()
        .toggleThreadPanel(activeThreadRef, input.threadPanelPresentation);
  });
  const toggleRightPanelMaximizedStable = useStableCallback(() => {
    if (input.canMaximizeRightPanel && activeThreadRef)
      useRightPanelStore.getState().setMaximized(activeThreadRef, !input.rightPanelMaximized);
  });
  const closeRightPanelStable = useStableCallback(() => {
    if (activeThreadRef) useRightPanelStore.getState().close(activeThreadRef);
  });
  const moveRightPanelSurfaceStable = useStableCallback((surfaceId: string, toIndex: number) => {
    if (activeThreadRef)
      useRightPanelStore.getState().moveSurface(activeThreadRef, surfaceId, toIndex);
  });
  const copyRightPanelFilePathStable = useStableCallback((relativePath: string) => {
    const formatted = formatFilePathForClipboard(
      relativePath,
      resolvePathLinkTarget(relativePath, input.gitCwd ?? input.activeProjectCwd ?? ""),
    );
    void navigator.clipboard.writeText(formatted);
  });
  const shortcuts = {
    "rightPanel.toggle": toggleRightPanelStable,
    "rightPanel.toggleMaximized": ({ event }) => {
      if (!event.repeat) toggleRightPanelMaximizedStable();
    },
    "threadPanel.toggle": toggleThreadPanelStable,
    "rightPanel.close": ({ event }) => {
      if (!input.activeRightPanelSurface) return false;
      if (!event.repeat) input.closeRightPanelSurface(input.activeRightPanelSurface);
    },
  } satisfies ChatShortcutCommands;
  return {
    shortcuts,
    activateRightPanelSurfaceStable,
    addDeviceSurfaceStable,
    addFilesSurfaceStable,
    copyRightPanelFilePathStable,
    moveRightPanelSurfaceStable,
    openFileSurfaceStable,
    toggleRightPanelMaximizedStable,
    toggleRightPanelStable,
    toggleThreadPanelStable,
    closeRightPanelStable,
  };
}
