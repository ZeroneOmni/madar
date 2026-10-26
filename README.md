# Madar

Madar is a fork of [T3 Code](https://github.com/pingdotgg/t3code), maintained by ZeroneOmni. It provides a desktop interface for coding agents using your provider accounts.

Development uses pull requests and required CI. Stable releases are built manually for Windows x64, macOS Apple Silicon, and Linux x64/ARM64.

## Install

Download Madar's installers from [this repository's releases](https://github.com/ZeroneOmni/madar/releases) once a release is published. Windows uses an NSIS installer, macOS uses a DMG, and Linux has AppImage and Debian packages. The CLI archives are also attached to each release.

The desktop app uses its own identity, URL handlers, profile, `.madar` home folder, and `madar` launcher so it can coexist with an installed T3 Code app.

To install only the CLI, download and inspect [install.sh](scripts/install.sh) for macOS/Linux or [install.ps1](scripts/install.ps1) for Windows, then run it locally. These scripts download from ZeroneOmni/madar and create the `madar` command. At least one coding provider must already be installed and authenticated.

Madar is distributed through this repository's releases. The upstream npm, Homebrew, winget, Scoop, AUR, mobile stores, website, and hosted Connect service belong to T3 Code.

## Development and releases

Install [Vite+](https://viteplus.dev/guide/), then run:

```sh
vp i
vp run dev:desktop
```

See [maintainer setup and releases](docs/operations/madar.md) for the PR workflow, GitHub-hosted runners, supported build targets, signing, and draft releases.

The [documentation](docs/) and [architecture overview](docs/internals/overview.md) are inherited from upstream. Some pages still use upstream product names and distribution instructions; use this README and the Madar maintainer guide for installation and releases.

Original T3 Code attribution and license notices are retained.
