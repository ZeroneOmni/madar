import type { DesktopBridge } from "@madar/contracts";

export function installDesktopPasteAsText(
  bridge: Pick<DesktopBridge, "onMenuAction" | "pasteAsText"> | undefined,
): (() => void) | undefined {
  return bridge?.onMenuAction((action) => {
    if (action !== "paste-as-text") return;
    void bridge.pasteAsText?.();
  });
}
