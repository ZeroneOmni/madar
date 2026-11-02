// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- standalone repository verification.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const retiredPaths = [
  ".repos",
  ".cursor",
  "CLAUDE.md",
  "native/resource-monitor",
  "apps/server/src/resourceTelemetry",
  "apps/desktop/src/telemetry",
  "apps/desktop/src/electron/ElectronPowerMonitor.ts",
  "apps/desktop/src/updates/remoteUpdateFlow.ts",
  "apps/desktop/src/updates/remoteUpdateFlow.test.ts",
  "apps/desktop/src/updates/DesktopRemoteUpdates.ts",
  "apps/desktop/src/updates/DesktopRemoteUpdates.test.ts",
  "packages/contracts/src/resourceTelemetry.ts",
  "packages/contracts/src/background.ts",
  "scripts/sync-reference-repos.ts",
  "scripts/sync-reference-repos.test.ts",
  "scripts/lib/reference-repos.ts",
  "docs/internals/resource-telemetry.md",
  "apps/server/src/cloud/traceRelayRequest.ts",
  "packages/shared/src/relayTracing.ts",
  "packages/shared/src/telemetryId.ts",
  "oxlint-plugin-madar/rules/no-raw-mcp-registration.ts",
  "oxlint-plugin-madar/rules/no-raw-mcp-registration.test.ts",
  "oxlint-plugin-madar/rules/no-rpc-permission-bypass.ts",
  "oxlint-plugin-madar/rules/no-rpc-permission-bypass.test.ts",
  "packages/client-runtime/src/errors/transport.ts",
  "packages/client-runtime/src/errors/transport.test.ts",
  "packages/client-runtime/src/errors/network.ts",
  "packages/shared/src/advertisedEndpoint.ts",
  "packages/contracts/src/remoteAccess.ts",
  "packages/client-runtime/src/environment/endpoint.test.ts",
  ".github/scripts/stage-preview-bundle.py",
  ".github/scripts/stage-preview-bundle.test.py",
  "apps/server/src/environmentTheme.ts",
  "apps/server/src/cli/theme.ts",
  "apps/server/scripts/madar-sqlite-state.ts",
  "apps/server/scripts/madar-sqlite-state.test.ts",
  "apps/web/src/themePalette.ts",
  "packages/shared/src/themePalettes.ts",
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
const retiredInfrastructure =
  /resourceTelemetry|resource-monitor|resourceMonitor|DesktopTelemetry|desktopTelemetry|DesktopRendererHistory|ElectronPowerMonitor|DesktopRemoteUpdates|remoteUpdateFlow|MADAR_POSTHOG|MADAR_TELEMETRY|\.repos\//;
for (const directory of [
  "apps",
  "packages",
  "scripts",
  "docs",
  ".github",
  ".devcontainer",
  ".vscode",
]) {
  const pending = [NodePath.join(root, directory)];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of NodeFS.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const filename = NodePath.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          !["node_modules", "dist", "dist-electron", "vendor", ".vite-plus"].includes(entry.name)
        ) {
          pending.push(filename);
        }
      } else if (
        entry.isFile() &&
        /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md)$/.test(entry.name) &&
        filename !== NodeURL.fileURLToPath(import.meta.url)
      ) {
        NodeAssert.equal(
          retiredInfrastructure.test(NodeFS.readFileSync(filename, "utf8")),
          false,
          NodePath.relative(root, filename),
        );
      }
    }
  }
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
  "getRelayTelemetryEnabled",
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
for (const [relative, pattern] of [
  [
    "vite.config.ts",
    /source-control|provider-testing|orchestration-v2|no-raw-mcp|no-rpc-permission|Composer|AuthSurfaceShell|JetBrainsIcons/,
  ],
  ["oxlint-plugin-madar/index.ts", /noRawMcp|noRpcPermission/],
  [".github/scripts/ci-changes.cjs", /@madar\/provider-/],
  [".github/workflows/ci.yml", /source-control|GraphQL/],
  ["scripts/check-changed.ts", /source-control|graphql|GraphQL/],
  ["apps/server/vite.config.ts", /CLERK|RELAY|repoEnv|history worker|orchestration/],
  ["apps/web/vite.config.ts", /VITE_WS_URL|VITE_HTTP_URL|configuredWsUrl|prefix === "\/ws"/],
  ["apps/web/src/vite-env.d.ts", /VITE_WS_URL|VITE_HTTP_URL/],
  ["packages/contracts/src/ipc.ts", /wsBaseUrl/],
  ["apps/desktop/src/ipc/methods/window.ts", /wsBaseUrl|toWebSocketBaseUrl/],
  ["apps/server/src/server.ts", /websocket:|perMessageDeflate/],
  ["apps/server/README.md", /WebSocket/],
  ["scripts/build-desktop-artifact.ts", /claude-agent|installed Claude|Cursor walks/],
  ["packages/shared/src/devProxy.ts", /\/mcp|\/ws/],
  ["packages/contracts/src/baseSchemas.ts", /ClientConnectionMethod|RpcClientId/],
  ["packages/contracts/src/desktopBootstrap.ts", /WSL/],
  ["apps/server/src/process/externalLauncher.ts", /Wsl|WSL|SSH_/],
  [
    "apps/web/src/lib/desktopPasteAsText.ts",
    /COMPOSER|composer|DESKTOP_PASTE_AS_TEXT_EVENT|dispatchEvent/,
  ],
  ["apps/desktop/src/window/DesktopWindow.ts", /disableHtmlFullscreenWindowResize|webview/],
  ["packages/shared/src/semver.ts", /SSH startup/],
  [
    "packages/shared/src/shell.ts",
    /XcodeGit|MacosGit|GitForWindows|bypassNpmShim|npmShimExecutable/,
  ],
  ["packages/contracts/src/baseSchemas.ts", /ForwardCompatibleUnion|ClientOs|ClientDeviceType/],
  ["apps/server/src/testUtils/shardWeights.json", /cli\/theme/],
  ["docs/internals/web-ui.md", /ComposerBanner|ChatView|ChatComposer/],
  ["docs/internals/environment-auth.md", /WebSocket|RpcAuthorization|RpcScopeAuthorization/],
  [
    "packages/client-runtime/README.md",
    /state\/threads|state\/terminal|state\/vcs|operations\/projects/,
  ],
  ["docs/operations/development.md", /Setup Worktree|generated GraphQL/],
  [".github/ISSUE_TEMPLATE/bug_report.yml", /composer|thread|prompt|Codex|provider session/],
  [".github/pull_request_template.md", /new threads/],
  ["packages/contracts/src/auth.ts", /AuthMcp|WebSocket/],
  ["apps/server/src/auth/SessionStore.ts", /WebSocket/],
  ["apps/server/src/cli/config.ts", /logWebSocketEvents|LOG_WS_EVENTS|log-websocket-events/],
  ["scripts/dev-runner.ts", /logWebSocketEvents|LOG_WS_EVENTS|log-websocket-events/],
  ["apps/web/src/index.css", /data-theme-id|stage-art-|stage-night-|--message-/],
  ["pnpm-workspace.yaml", /clerk|webauthn|opencode|mdast|micromark|remark-|rehype-|unified/],
  [
    "apps/server/src/observability/Metrics.ts",
    /t3_|providerSessions|providerTurns|orchestrationEffect|gitCommands|secretRefs/,
  ],
  [
    "apps/server/src/persistence/Errors.ts",
    /threadId|Orchestration|ProviderSession|PullRequest|ProjectionRepository/,
  ],
  ["apps/web/index.html", /CUSTOM_THEMES|LEGACY_THEME|theme-halves/],
  ["apps/desktop/src/permissions/MacPermission.ts", /screen-recording|accessibility/],
] as const) {
  NodeAssert.doesNotMatch(
    NodeFS.readFileSync(NodePath.join(root, relative), "utf8"),
    pattern,
    relative,
  );
}
for (const relative of ["vite.config.ts", "knip.jsonc"]) {
  const contents = NodeFS.readFileSync(NodePath.join(root, relative), "utf8");
  for (const match of contents.matchAll(/"((?:apps|packages)\/[^"*{}]+\.[a-z]+)!?"/g)) {
    NodeAssert.ok(NodeFS.existsSync(NodePath.join(root, match[1]!)), `${relative}: ${match[1]}`);
  }
}
const documents = [
  NodePath.join(root, "packages/client-runtime/README.md"),
  ...NodeFS.readdirSync(NodePath.join(root, "docs"), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => NodePath.join(entry.parentPath, entry.name)),
];
for (const filename of documents) {
  const contents = NodeFS.readFileSync(filename, "utf8");
  for (const match of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]!.split("#")[0]!;
    if (!target || /^\w+:/.test(target)) continue;
    NodeAssert.ok(
      NodeFS.existsSync(NodePath.resolve(NodePath.dirname(filename), target)),
      `${NodePath.relative(root, filename)}: ${target}`,
    );
  }
}
console.log(
  "PASS: retired features, obsolete configuration and broken documentation links remain absent",
);
