import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import { useStableCallback } from "./useStableCallback";
export function useRightPanelSurfaceClose(input: { readonly threadRef: ScopedThreadRef | null }) {
  const { threadRef } = input;
  const surfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );
  const closeSurface = useStableCallback((surface: RightPanelSurface) => {
    if (threadRef) useRightPanelStore.getState().closeSurface(threadRef, surface.id);
  });
  const closeOtherSurfaces = useStableCallback((surface: RightPanelSurface) => {
    if (threadRef) useRightPanelStore.getState().closeOtherSurfaces(threadRef, surface.id);
  });
  const closeSurfacesToRight = useStableCallback((surface: RightPanelSurface) => {
    if (threadRef) useRightPanelStore.getState().closeSurfacesToRight(threadRef, surface.id);
  });
  const closeAllSurfaces = useStableCallback(() => {
    if (threadRef && surfaces.length > 0) useRightPanelStore.getState().closeAllSurfaces(threadRef);
  });
  return {
    closeSurface,
    closeOtherSurfaces,
    closeSurfacesToRight,
    closeAllSurfaces,
  };
}
