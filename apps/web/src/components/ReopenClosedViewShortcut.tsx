import { isModelPickerOpen } from "../modelPickerVisibility";
import { isEditableFocused } from "../lib/editableFocus";
import { resolveShortcutCommand } from "../keybindings";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useParams } from "@tanstack/react-router";
import { useEffectEvent, useRef } from "react";
import { useClosedViewStore } from "../closedViewStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { environmentCatalog } from "../connection/catalog";
import { planNextReopen, reopenClosedView } from "../reopenClosedView";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProject, readThreadShell } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { toastManager } from "./ui/toast";

export function ReopenClosedViewShortcut() {
  const params = useParams({
    strict: false,
  });
  const target = resolveThreadRouteTarget(params);
  const draft = useComposerDraftStore((state) =>
    target?.kind === "draft" ? state.getDraftSession(target.draftId) : null,
  );

  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  const pending = useRef(Promise.resolve());
  const reopenNext = useEffectEvent(async () => {
    const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
    const drafts = useComposerDraftStore.getState();
    const panelsByThread = useRightPanelStore.getState().byThreadKey;
    const { drop, restore } = planNextReopen(useClosedViewStore.getState().entries, (entry) => {
      const ref = entry.threadRef;
      const panel = selectThreadRightPanelState(panelsByThread, ref);
      return {
        environmentKnown: catalog.entries.has(ref.environmentId),
        catalogReady: catalog.isReady,
        ownerExists: readThreadShell(ref) !== null || drafts.getDraftThreadByRef(ref) !== null,
        shellLive:
          appAtomRegistry.get(environmentShell.stateValueAtom(ref.environmentId)).status === "live",
        panel,
      };
    });
    for (const entry of drop) useClosedViewStore.getState().remove(entry.id);
    if (!restore) return;
    const ref = restore.threadRef;
    const thread = readThreadShell(ref);
    const owner = thread ?? drafts.getDraftThreadByRef(ref);
    const project = owner ? readProject(scopeProjectRef(ref.environmentId, owner.projectId)) : null;
    if (
      !(await reopenClosedView(restore, {
        workspaceAvailable: project !== null,
      }))
    ) {
      useClosedViewStore.getState().defer(restore.id);
      return;
    }
    useClosedViewStore.getState().remove(restore.id);
  });
  const enqueueReopen = useEffectEvent(() => {
    pending.current = pending.current
      .then(() => reopenNext())
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not reopen view",
          description: error instanceof Error ? error.message : String(error),
        });
      });
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isCommandPaletteOpen() ||
        useClosedViewStore.getState().entries.length === 0 ||
        (event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]"))
      )
        return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: false,
          terminalOpen: false,
          previewFocus: false,
          previewOpen: false,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "view.reopenClosed") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) enqueueReopen();
    };
    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "view.reopenClosed" && !isCommandPaletteOpen()) enqueueReopen();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe?.();
    };
  }, [keybindings]);
  return null;
}
