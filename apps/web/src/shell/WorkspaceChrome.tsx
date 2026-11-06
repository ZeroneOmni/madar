import type { CSSProperties, ReactNode } from "react";
import { SidebarTrigger, useSidebar } from "../components/ui/sidebar";
import { useNativeTitlebarInsets } from "../lib/windowControlsOverlay";
import { useLocale } from "../useLocale";

export function WorkspaceChrome({ children }: { children: ReactNode }) {
  const { direction } = useLocale();
  const { open, isMobile } = useSidebar();
  const native = useNativeTitlebarInsets();
  const right = direction === "rtl";
  const inset = right ? native.right : native.left;
  const sidebarSize = isMobile
    ? "0px"
    : open
      ? "var(--sidebar-width)"
      : "var(--sidebar-width-icon)";
  const gutter = "var(--workspace-titlebar-control-gap)";
  const toggleSpace = `var(--workspace-titlebar-control-size) + ${gutter}`;
  const style: CSSProperties & Record<`--${string}`, string> = {
    "--workspace-topbar-height": `max(40px, ${native.height || 52}px)`,
    "--shell-toggle-offset": `calc(${inset}px + ${gutter})`,
    "--shell-brand-inset": inset > 0 ? gutter : `calc(${gutter} + ${toggleSpace})`,
    "--shell-sidebar-caption-height": `${inset > 0 ? native.height : 0}px`,
    "--shell-header-left": `max(var(--workspace-gutter), calc(${native.left}px + ${gutter} + ${right ? "0px" : toggleSpace} - ${right ? "0px" : sidebarSize}))`,
    "--shell-header-right": `max(var(--workspace-gutter), calc(${native.right}px + ${gutter} + ${right ? toggleSpace : "0px"} - ${right ? sidebarSize : "0px"}))`,
  };

  return (
    <div className="contents" style={style}>
      {children}
      {/* Electron processes native drag regions in document order; controls must follow draggable surfaces. */}
      <div className="fixed top-[calc((var(--workspace-topbar-height)-var(--workspace-titlebar-control-size))/2)] start-(--shell-toggle-offset) z-30">
        <SidebarTrigger />
      </div>
    </div>
  );
}
