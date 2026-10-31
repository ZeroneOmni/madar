# Maintaining Madar

Create a short branch name without slashes, push it, and open a pull request against `main`. CI's `Check` is required. Review the changes and squash merge after checks pass. No second human approval is required for the solo maintainer.

## Runners

CI, Windows tests, and releases use standard GitHub-hosted runners: `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-26`, and `windows-2025`. No third-party runner setup is required.

## Stable releases

After merging and waiting for main CI to pass, open **Actions > Release > Run workflow** on `main`. Enter a new stable version such as `0.1.0`. Optionally enter the full SHA of an older merged main commit whose main CI passed. A version tag cannot be reused. The workflow builds that exact commit and creates a draft release by default. Test its installers before publishing the draft in GitHub Releases. Select **Publish immediately** only when you intend to ship it directly.

| Platform | Native build          | Files                                 |
| -------- | --------------------- | ------------------------------------- |
| Windows  | x64                   | NSIS installers, CLI zip archives     |
| macOS    | ARM64 (Apple Silicon) | DMG, updater zip, CLI archive         |
| Linux    | x64 and ARM64         | AppImage, Debian package, CLI archive |

All builds must succeed. Windows embeds the same-architecture Linux CLI archive for WSL. Releases include updater manifests and SHA-256 checksums. The desktop and bundled CLI update from `ZeroneOmni/madar`. There are no scheduled nightlies, npm publications, AUR publications, mobile-store releases, or upstream hosted-service deployments.

Windows x64 artifacts target Windows 10 and 11, but hosted x64 builds run on Windows Server 2025. Test installation, startup, provider sign-in, terminal, WSL, and upgrade on actual Windows 10 and 11 machines before claiming those versions verified. Also test on Apple Silicon and the Linux distributions you support. CI build success alone does not establish compatibility on every OS version.

## Signing and remote services

Unsigned builds work without signing credentials. For trusted distribution, configure your own certificates in GitHub's repository secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, plus the `APPLE_TEAM_ID` variable for macOS. Windows supports the `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TRUSTED_SIGNING_*` secrets used by `release-desktop.yml`. Never reuse upstream credentials. Unsigned apps can trigger OS warnings; Apple notarization requires an Apple Developer account.

This fork does not configure T3's hosted Clerk, relay, telemetry exporters, marketing site, or store accounts. Local providers and direct server connections do not need those credentials. Deploying your own Connect service is a separate setup.

## Coexisting with T3 Code

Madar uses its own app ID, `madar:` / `madar-dev:` URL handlers, Electron profile, default `.madar` home, and `madar` desktop launcher. Keep its `MADAR_HOME` override unset unless intentionally choosing a different folder. Workspace packages use the `@madar/*` namespace, and configuration variables use the `MADAR_*` prefix.

Fetch upstream changes, integrate them on a new branch, and open a PR so CI runs before merging. The `upstream` remote points to `pingdotgg/t3code`; release assets always belong to this fork.
