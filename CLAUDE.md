# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TEMPOC shows how far you are through Claude's usage windows. claude.ai reports how much of each window you have consumed, but not how much of the window's *time* has elapsed, nor exactly when it resets. Both modules below intercept the same claude.ai usage API and answer those two questions; they differ only in how they present the answer.

## Modules

This repository holds **two independent modules**. They share no code and have separate versions and release pipelines — a change to one should not touch the other.

| Module | What it is | Guide |
|---|---|---|
| `chrome-extension/` | Manifest V3 Chrome extension that injects progress bars into the claude.ai usage page | [`chrome-extension/CLAUDE.md`](chrome-extension/CLAUDE.md) |
| `desktop/` | Standalone Wails v3 desktop app (Windows) that renders the same data in its own frameless React window, loading claude.ai in a hidden WebView | [`desktop/CLAUDE.md`](desktop/CLAUDE.md) |

**Read the module's own guide before working in it.** Each covers that module's architecture, settings, build commands, and constraints. This file covers only what spans both.

## Repo-wide layout

| Path | Role |
|---|---|
| `.github/workflows/` | CI for both modules. Each file is named `<job>-<module>.yml` and its tag pattern / `paths:` filter keeps it from firing for the other module |
| `.github/variables` | Pinned tool versions shared by workflows (currently `WAILS_VERSION`). Loaded with `grep -E '^[A-Z_]+=' .github/variables >> "$GITHUB_ENV"` — plain `cat` would choke on the file's comments |
| `.claude/skills/` | `wails3` (Wails v3 practices) and `tempoc-desktop-verify` (driving the built desktop exe over CDP) |
| `locales/` | **Master** of the locale JSON files shared by both modules (one file per locale, flat keys with `{token}` templates). Edit translations here only |
| `scripts/` | Repo-wide tooling. `sync_locales.py` validates `locales/` (key/placeholder parity across all files) and rewrites both modules' committed copies |
| `README.md` | User-facing entry point: what TEMPOC is, the shared bar/color concept, and the privacy & disclaimer terms that cover both modules. Per-module install and settings docs live in each module's own `README.md`, which this one links to |

`README.md` and `LICENSE` stay at the root and cover both modules. Keep anything user-facing that is true of both — the concept, privacy, disclaimer, license — in the root `README.md` only, and anything install- or settings-specific in the module's `README.md` only, so the two never drift into contradicting each other.

## Shared locale resources

The i18n message JSON is the one asset both modules consume. The master is `locales/` at the root; `desktop/frontend/src/locales/` and `chrome-extension/src/locales/` are **committed copies** written by `python3 scripts/sync_locales.py` — committed because neither module can reach outside its own directory when packaged (the extension zip is just `src/`, with no build step). Never edit the copies directly; `.github/workflows/check-locales.yml` fails the build if a copy drifts from the master.

Consequences to keep in mind:

- A translation change is one commit that touches both modules, so it triggers **both** versionup workflows and releases both modules. That is usually what you want for wording fixes; there is no way to ship a shared-string change to only one module.
- Key completeness is enforced twice: `sync_locales.py` compares every locale against `en-US.json` (keys and `{token}` placeholders), and the desktop build re-checks typed keys via `RawMessages` in `desktop/frontend/src/i18n.ts`. Keys used only by the extension (e.g. `previewLabel`, `refreshHelp`, `savedToast`) are still listed in `RawMessages` so the desktop type check covers them too.
- Adding a language or a key therefore spans both modules by design: edit `locales/`, run the sync script, and follow each module's guide for the code side (`SUPPORTED_LOCALES` in `desktop/frontend/src/i18n.ts`, `TEMPOC_LOCALES` in `chrome-extension/src/i18n.js`).

## Versioning

The two modules version independently, and **each release tag is namespaced by module** so that one module's tag can never trigger the other's release workflow:

| Module | Tag | Source of truth | Release artifact |
|---|---|---|---|
| `chrome-extension/` | `extension-v*` | `chrome-extension/version` | zip of `src/` |
| `desktop/` | `desktop-v*` | `desktop/version` | per-OS: `tempoc.exe` zip (Windows), `.app` zip (macOS arm64), binary tarball (Linux) |

Tags of the form `v*` are pre-split extension releases (up to `v1.2.6`). They are left in place but trigger nothing; only `chrome-extension/scripts/versionup.py` still reads them, so that the next version computed after `v1.2.6` is `1.2.7`. Do not add new `v*` tags.

**Both modules release automatically; no tag is ever pushed by hand.** Each module has the same pair of workflows, distinguished only by its `paths:` filter and tag prefix:

1. `versionup-<module>.yml` — on a push to `main` touching that module, computes the next version, commits the bump through a PR it merges itself, and pushes the module's tag.
2. `release-<module>.yml` — on that tag, builds and attaches the artifact to a **draft** release.

The version file holds the *next* version: if its value is already tagged, the bump is a patch; if not, the value is used as-is. **Editing `<module>/version` by hand is therefore how a minor or major release is started** — commit the new value and the pipeline releases exactly it.

The two differ in what a bump has to touch. The extension's version lives in two files (`version`, `src/manifest.json`) and `versionup.py` writes both. The desktop's exe metadata is baked from `build/config.yml` into generated assets at build time, so its bump additionally runs `wails3 update build-assets`, and the regenerated assets get committed with the bump. `release-desktop.yml` re-checks that the tag, `desktop/version` and the committed `build/windows/info.json` all agree, and refuses to build otherwise — that guard exists because a hand-edited version bump that skips `update build-assets` would otherwise ship an exe whose version disagrees with its release.
