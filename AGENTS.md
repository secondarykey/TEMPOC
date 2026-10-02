# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

TEMPOC shows how far you are through Claude's usage windows. claude.ai reports how much of each window you have consumed, but not how much of the window's *time* has elapsed, nor exactly when it resets. The modules below answer those two questions from the same usage figures; they differ in where they read them and how they present the answer.

## Modules

This repository holds **independent modules**. They share no code and have separate versions and release pipelines — a change to one should not touch the other.

| Module | What it is | Guide |
|---|---|---|
| `chrome-extension/` | Manifest V3 Chrome extension that injects progress bars into the claude.ai usage page | [`chrome-extension/AGENTS.md`](chrome-extension/AGENTS.md) |
| `desktop/` | Standalone Wails v3 desktop app (Windows) that renders the same data in its own frameless React window, loading claude.ai in a hidden WebView | [`desktop/AGENTS.md`](desktop/AGENTS.md) |
| `claude-mods/` | Claude Code mods (plugins of function hooks) and the marketplace that distributes them. `tempoc` draws the bars above the prompt from the rate-limit windows Claude Code itself receives. Not in the locale pipeline below; versioned like the others but released differently (see Versioning) | [`claude-mods/AGENTS.md`](claude-mods/AGENTS.md) |

**Read the module's own guide before working in it.** Each covers that module's architecture, settings, build commands, and constraints. This file covers only what spans both.

## Repo-wide layout

| Path | Role |
|---|---|
| `.claude-plugin/` | The Claude Code marketplace catalog of `claude-mods/` (`marketplace.json`). It belongs to that module but has to sit at the root: adding a marketplace by repository reads only the root. See [`claude-mods/AGENTS.md`](claude-mods/AGENTS.md) |
| `.github/workflows/` | CI for both modules. Each file is named `<job>-<module>.yml` and its tag pattern / `paths:` filter keeps it from firing for the other module |
| `.github/variables` | Pinned tool versions shared by workflows (currently `WAILS_VERSION`). Loaded with `grep -E '^[A-Z_]+=' .github/variables >> "$GITHUB_ENV"` — plain `cat` would choke on the file's comments |
| `docs/skills/` | Task procedures and references, one directory per skill (`<name>/SKILL.md` with `name` / `description` frontmatter). Read the matching skill before doing that task: `tempoc-i18n` (languages and message keys, both modules), `tempoc-desktop-release` (desktop versioning, build assets, release, signing), `tempoc-desktop-ui` (desktop bar display and settings keys), `tempoc-desktop-verify` (driving the built desktop exe over CDP). Agents that load skills from their own directory (e.g. `.claude/skills/`) can link it here locally; that link is not committed |
| `locales/` | **Master** of the locale JSON files shared by both modules (one file per locale, flat keys with `{token}` templates). Edit translations here only |
| `scripts/` | Repo-wide tooling. `sync_locales.py` validates `locales/` (key/placeholder parity across all files) and rewrites both modules' committed copies; `locale_impact.py` reports which modules a diff actually reaches, and gates both versionup workflows |
| `README.md` | User-facing entry point: what TEMPOC is, the shared bar/color concept, and the privacy & disclaimer terms that cover both modules. Per-module install and settings docs live in each module's own `README.md`, which this one links to |

`README.md` and `LICENSE` stay at the root and cover both modules. Keep anything user-facing that is true of both — the concept, privacy, disclaimer, license — in the root `README.md` only, and anything install- or settings-specific in the module's `README.md` only, so the two never drift into contradicting each other.

## Shared locale resources

The i18n message JSON is the one asset both modules consume. The master is `locales/` at the root; `desktop/frontend/src/locales/` and `chrome-extension/src/locales/` are **committed copies** written by `python3 scripts/sync_locales.py` — committed because neither module can reach outside its own directory when packaged (the extension zip is just `src/`, with no build step). Never edit the copies directly; `.github/workflows/check-locales.yml` fails the build if a copy drifts from the master.

Consequences to keep in mind:

- A translation change is one commit that touches both modules, so a `paths: <module>/**` filter alone starts **both** versionup workflows. Each one therefore runs `python3 scripts/locale_impact.py --module <module>` first and releases only if the diff reaches code that module actually runs:

  | What changed under the module | Released? |
  |---|---|
  | anything that is not a locale copy | yes |
  | a locale key the module's own source references | yes |
  | only locale keys it never reads | no |

  Run the same command locally to see the answer before pushing (`python3 scripts/locale_impact.py` reports both modules, `HEAD` vs `origin/main`). Which keys a module "reads" is derived from its own source: `RawMessages` in `desktop/frontend/src/i18n.ts` for the desktop, `data-i18n="…"` / `t.…` for the extension. **Neither module may declare the other's keys** — that is what makes the two answers independent.

  The check is a safe over-approximation (it matches key names as words, so a coincidence releases rather than skips), and it is not a judgement about whether a shared string is worth shipping. To override it, use a marker:

  | Marker | Effect |
  |---|---|
  | `[skip versionup:extension]` | releases desktop only |
  | `[skip versionup:desktop]` | releases the extension only |
  | `[skip versionup:mods]` | holds off the Claude Code mods (they read no locales, so only this marker or the one below stops them) |
  | `[skip versionup]` | releases none of the modules (what the automated bump merges use) |

  **The markers are read from the head commit of the push**, which in the normal PR flow is the *merge commit* — put them in the merge subject (`gh pr merge --subject`). A marker on a branch commit is never seen. **Skipping defers, it does not drop**: the synced copy stays on `main` and goes out with that module's next release.
- Key completeness is enforced per module: `sync_locales.py` compares every locale against `en-US.json` (keys and `{token}` placeholders) *and* checks that every key the extension's options page references exists there; the desktop build checks its own keys via `RawMessages`. The extension's keys are deliberately **not** listed in `RawMessages` — borrowing the type check that way would make every shared wording change look like a desktop change to `locale_impact.py`.
- Adding a language or a key therefore spans both modules by design. The step-by-step procedure for both is in the [`tempoc-i18n`](docs/skills/tempoc-i18n/SKILL.md) skill.

## Versioning

The modules version independently, and **each release tag is namespaced by module** so that one module's tag can never trigger another's release workflow:

| Module | Tag | Source of truth | Release artifact |
|---|---|---|---|
| `chrome-extension/` | `extension-v*` | `chrome-extension/version` | zip of `src/` |
| `desktop/` | `desktop-v*` | `desktop/version` | per-OS: `tempoc.exe` zip (Windows), `.app` zip (macOS arm64), binary tarball (Linux) |
| `claude-mods/` | `mods-v*` | `claude-mods/version` | none: users install from `main` through the marketplace (see below) |

Tags of the form `v*` are pre-split extension releases (up to `v1.2.6`). They are left in place but trigger nothing; only `chrome-extension/scripts/versionup.py` still reads them, so that the next version computed after `v1.2.6` is `1.2.7`. Do not add new `v*` tags.

**Every module releases automatically; no tag is ever pushed by hand.** The extension and the desktop have the same pair of workflows, distinguished only by its `paths:` filter and tag prefix:

1. `versionup-<module>.yml` — on a push to `main` touching that module, computes the next version, commits the bump through a PR it merges itself, and pushes the module's tag.
2. `release-<module>.yml` — on that tag, builds and attaches the artifact to a **draft** release.

The version file holds the *next* version: if its value is already tagged, the bump is a patch; if not, the value is used as-is. **Editing `<module>/version` by hand is therefore how a minor or major release is started** — commit the new value and the pipeline releases exactly it. (For the desktop, make that edit with `go run ./_cmd/version.go <version>` so that its copies stay in sync; see `desktop/AGENTS.md`.)

`claude-mods/` has only the first, `versionup-mods.yml`, filtered to what ships (`claude-mods/tempoc/**` and `claude-mods/version`) and held off by `[skip versionup:mods]`. It has no release workflow and no artifact: Claude Code installs the plugin straight from `main`, and hands users a change only when the version in `claude-mods/tempoc/.claude-plugin/plugin.json` changes. So the bump reaching `main` *is* the release; the `mods-v*` tag only marks the version as taken. `claude-mods/scripts/versionup.py` writes both `version` and that `plugin.json`.

The extension and the desktop differ in what a bump has to touch. The extension's version lives in two files (`version`, `src/manifest.json`) and `versionup.py` writes both. The desktop's exe metadata is baked from `build/config.yml` into generated assets at build time, so its bump additionally runs `wails3 update build-assets`, and the regenerated assets get committed with the bump. `release-desktop.yml` re-checks that the tag, `desktop/version` and the committed `build/windows/info.json` all agree, and refuses to build otherwise — that guard exists because a hand-edited version bump that skips `update build-assets` would otherwise ship an exe whose version disagrees with its release.
