import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { RightPanelTabs } from "./RightPanelTabs";
it("opens the file and device menu with the new-panel shortcut", async () => {
  await using screen = await render(
    <RightPanelTabs
      mode="embedded"
      open
      keybindings={mergeWithDefaultKeybindings([])}
      surfaces={[]}
      environmentId={null}
      activeSurfaceId={null}
      pendingSurfaceIds={new Set()}
      onActivate={() => undefined}
      onCloseSurface={() => undefined}
      onCloseOtherSurfaces={() => undefined}
      onCloseSurfacesToRight={() => undefined}
      onCloseAllSurfaces={() => undefined}
      onCopyFilePath={() => undefined}
      onAddFiles={() => undefined}
      onAddDevice={() => undefined}
      filesAvailable
      deviceAvailable
    >
      <p>Panel content</p>
    </RightPanelTabs>,
  );
  await userEvent.keyboard(
    /Mac/.test(navigator.platform) ? "{Meta>}t{/Meta}" : "{Control>}t{/Control}",
  );
  await expect.element(page.getByRole("menuitem", { name: "Files", exact: true })).toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: "Device", exact: true })).toBeVisible();
});
