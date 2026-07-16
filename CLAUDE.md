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
| `.github/workflows/` | CI for both modules. Workflow names carry the module they serve, and `paths:` filters keep them from firing for the other module |
| `.claude/skills/` | `wails3` (Wails v3 practices) and `tempoc-desktop-verify` (driving the built desktop exe over CDP) |
| `README.md` | User-facing documentation |
| `FEATURES.md` | Working notes on planned features |

`README.md`, `LICENSE`, and `FEATURES.md` stay at the root and cover both modules.

## Versioning

The two modules version independently, and **each release tag is namespaced by module** so that one module's tag can never trigger the other's release workflow:

| Module | Tag | Source of truth | Bump with |
|---|---|---|---|
| `chrome-extension/` | `extension-v*` | `chrome-extension/version` | automatic, on push to `main` |
| `desktop/` | `desktop-v*` (no release workflow yet) | `desktop/version` | `go run ./_cmd/version.go` from `desktop/` |

Tags of the form `v*` are pre-split extension releases (up to `v1.2.6`). They are left in place but trigger nothing; only `chrome-extension/scripts/versionup.py` still reads them, so that the next version computed after `v1.2.6` is `1.2.7`. Do not add new `v*` tags.

The two pipelines differ in kind, so don't reach for one module's habits in the other. The extension bumps **itself**: any push to `main` touching `chrome-extension/**` runs `versionup.py`, which opens and merges a bump PR and pushes the tag. The desktop app bumps **on demand**: `go run ./_cmd/version.go` mirrors `desktop/version` into `build/config.yml` and `frontend/package.json`, and the exe metadata is baked from `config.yml` at build time — so a version change only reaches users after `wails3 task common:update:build-assets` and a rebuild. Details in each module's guide.

The desktop app has no release workflow yet; `desktop-v*` is reserved for it.
