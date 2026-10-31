// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- standalone repository verification.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const retiredPaths = [
  "packages/contracts/src/project.ts",
  "packages/contracts/src/acpRegistry.ts",
  "packages/contracts/src/providerInstance.ts",
  "packages/contracts/src/providerRuntime.ts",
  "packages/contracts/src/providerUsageLimits.ts",
  "packages/contracts/src/usageLimitSourceId.ts",
  "packages/contracts/src/providerPolicy.ts",
  "packages/contracts/src/modelSelection.ts",
  "packages/contracts/src/chatAttachment.ts",
  "packages/contracts/src/model.ts",
  "packages/contracts/src/keybindings.ts",
  "packages/contracts/src/vcs.ts",
  "packages/contracts/src/sourceControl.ts",
  "packages/contracts/src/pullRequest.ts",
  "packages/contracts/src/browserProfile.ts",
  "packages/contracts/src/preview.ts",
  "packages/contracts/src/desktopAppActivation.ts",
  "apps/server/src/cli/app.ts",
  "apps/desktop/src/app/DesktopAppActivation.ts",
  "apps/desktop/src/app/DesktopAppActivationBroker.ts",
  "apps/desktop/src/ipc/methods/appActivation.ts",
  "packages/shared/src/desktopAppControl.ts",
  "packages/shared/src/keybindings.ts",
  "packages/shared/src/projectFavicon.ts",
  "packages/shared/src/video.ts",
  "packages/shared/src/image.ts",
  "packages/contracts/src/orchestrationV2.ts",
  "packages/contracts/src/orchestrationV2IdTable.ts",
  "packages/contracts/src/composerContext.ts",
  "packages/contracts/src/composerContextClipboard.ts",
  "packages/contracts/src/guestShare.ts",
  "packages/contracts/src/orchestrationProject.ts",
  "packages/contracts/src/threadPullRequest.ts",
  "packages/contracts/src/threadSearch.ts",
  "packages/contracts/src/assets.ts",
  "packages/client-runtime/src/authorization/service.ts",
  "packages/client-runtime/src/authorization/tokenStore.ts",
  "packages/client-runtime/src/connection/catalog.ts",
  "packages/client-runtime/src/connection/model.ts",
  "packages/client-runtime/src/platform/storageDocument.ts",
  "apps/desktop/src/app/DesktopWebLinks.ts",
  "apps/desktop/src/ipc/methods/webLinks.ts",
  "packages/shared/src/relayAuth.ts",
  "packages/ssh",
  "apps/server/src/cli/sshHelper.ts",
  "apps/server/scripts/acp-thread-spawn-helper.c",
  "apps/server/src/assets/AttachmentUpload.ts",
  "apps/server/src/assets/MediaFile.ts",
  "apps/server/src/assets/NativeAppIconResolver.ts",
  "apps/server/src/attachmentStore.ts",
  "apps/server/src/attachmentPaths.ts",
  "apps/server/src/keybindings.ts",
  "apps/server/src/scheduling/Scheduler.ts",
  "apps/server/src/telemetry/AnalyticsService.ts",
  "apps/server/src/telemetry/Identify.ts",
  "apps/server/src/telemetry/ProviderDimensions.ts",
  "apps/desktop/src/app/DesktopConnectionCatalogStore.ts",
  "apps/desktop/src/settings/DesktopSavedEnvironments.ts",
  "apps/desktop/src/ipc/methods/connectionCatalog.ts",
  "apps/desktop/src/ipc/methods/notificationBadge.ts",
  "apps/web/scripts/ghostty-write-pty.zig",
  "packages/shared/src/composerContextClipboard.ts",
  "packages/shared/src/filePreview.ts",
  "packages/shared/src/htmlRender.ts",
  "packages/shared/src/mcpApp.ts",
  "packages/shared/src/t3McpToolPresentation.ts",
  "packages/shared/src/toolOutput.ts",
  "packages/shared/src/testing/providerEnv.ts",
];
for (const retired of retiredPaths) {
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(root, retired)), false, retired);
}
const preload = NodeFS.readFileSync(NodePath.join(root, "apps/desktop/src/preload.ts"), "utf8");
const handlers = NodeFS.readFileSync(
  NodePath.join(root, "apps/desktop/src/ipc/DesktopIpcHandlers.ts"),
  "utf8",
);
for (const method of [
  "webLinks",
  "appActivation",
  "setNotificationBadge",
  "onNotificationBadgeClear",
  "getConnectionCatalog",
  "setConnectionCatalog",
  "clearConnectionCatalog",
  "pickFolder",
  "pickProjectFavicon",
  "pickThemeFiles",
]) {
  const pattern = new RegExp("\\b" + method + "\\b");
  NodeAssert.equal(pattern.test(preload), false, "preload: " + method);
  NodeAssert.equal(pattern.test(handlers), false, "IPC: " + method);
}
for (const relative of [
  "scripts/build-desktop-artifact.ts",
  "scripts/build-desktop-artifact.test.ts",
  ".github/workflows/release-desktop.yml",
]) {
  NodeAssert.doesNotMatch(
    NodeFS.readFileSync(NodePath.join(root, relative), "utf8"),
    /WSL_RUNTIME|wslRuntime|wsl-runtime/,
    relative,
  );
}
for (const relative of [
  ".github/workflows/release-desktop.yml",
  ".github/workflows/release.yml",
  "scripts/build-desktop-artifact.ts",
  "scripts/lib/public-config.ts",
]) {
  NodeAssert.doesNotMatch(
    NodeFS.readFileSync(NodePath.join(root, relative), "utf8"),
    /CLERK|clerk_|MACOS_PROVISIONING_PROFILE|resolvePublicConfig/,
    relative,
  );
}
const ipc = NodeFS.readFileSync(NodePath.join(root, "packages/contracts/src/ipc.ts"), "utf8");
NodeAssert.doesNotMatch(ipc, /DesktopSsh|DesktopDiscoveredSsh|runningDistro/);
console.log("PASS: retired helpers, contracts, SSH/WSL integration and desktop IPC remain absent");
