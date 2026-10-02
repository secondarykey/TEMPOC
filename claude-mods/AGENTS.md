# claude-mods/AGENTS.md

Claude Code mods: plugins of **function hooks**. No build step: Claude Code compiles and runs each plugin's hooks module (`.tsx`) itself, in a sandbox of its own (no DOM, no Node; everything outside goes through the engine interface `$`). The API is early access: its authority is the `claude-code.d.ts` that Claude Code writes for the running build (`/plugin-types`, or the `plugin-authoring` skill). These notes were written against Claude Code 2.1.286.

This directory holds the module's plugins, one per subdirectory. They are distributed through a Claude Code **marketplace** whose catalog is the one file outside this directory: `.claude-plugin/marketplace.json` at the repository root (see below for why).

## Layout

| Path | Role |
|---|---|
| `../.claude-plugin/marketplace.json` | The marketplace, `tempoc`, at the repository root. Each entry's `source` is `git-subdir` (this repo, `claude-mods/<plugin>`), so the catalog also works when added by the raw URL of the file, where a relative source would not |
| `.gitignore` | Drops what Claude Code writes when it loads a plugin from a local folder. The root `.gitignore` re-includes every `.claude-plugin/` (it drops every other dot-path) |
| `tempoc/.claude-plugin/plugin.json` | Plugin manifest: `name` (must match the marketplace entry's), `version`, `types` |
| `tempoc/hooks/hooks.json` | Names the one hooks module |
| `tempoc/hooks/register.tsx` | The module |
| `version` | The next version, the source of truth (see Versioning) |
| `scripts/versionup.py` | Computes the version and writes it to `version` and `tempoc/.claude-plugin/plugin.json` |
| `tempoc/types/index.d.ts` | Contract for the `$.state` values the module keeps; `claude plugin validate` holds every state key the module names to it |

Why the catalog sits at the repository root: Claude Code reads manifests only from directories named exactly `.claude-plugin/`, and adding a marketplace by repository (`/plugin marketplace add secondarykey/TEMPOC`, or the same from a plugin browser) reads only the repo-root `.claude-plugin/marketplace.json`. No add command takes a path inside the repository; only `extraKnownMarketplaces` in settings does. With the catalog under `claude-mods/`, users had to add it by the file's raw URL, and a plugin browser that adds by repository could not reach it.

Why two `.claude-plugin/` directories: a plugin's folder is copied whole to each user's machine on install, so `tempoc/` holds only what ships, while the catalog and the module's own documents never ship.

## Versioning

`version` is the source of truth; `tempoc/.claude-plugin/plugin.json` carries a copy, because that is where Claude Code reads the plugin's version, and users receive a change only when that value changes (Claude Code keeps an installed copy per version and ignores new commits under the same one).

`.github/workflows/versionup-mods.yml` runs on a push to `main` that touches `tempoc/**` or `version`: `scripts/versionup.py` keeps an untagged `version` or bumps the patch of a tagged one, writes both files, merges the bump through a PR, and tags `mods-v<version>`. There is no release workflow: the bump reaching `main` is the release. Edit `version` by hand to start a minor or major one. A change to the catalog (`../.claude-plugin/`) or the docs alone is no release.

## tempoc: data

- Readings: `$.session.usage().rateLimits` at `session.start`, then `session.measure` whenever a window moves a whole point. Each window is `{ kind, percentUsed, resetsAt }`; `kind` is `five_hour` / `seven_day` (or a gateway's `spend_limit`, drawn without elapsed time). Elapsed % = `(span − (resetsAt − now)) / span`.
- State (`types/index.d.ts`): `windows` (latest reading), `view` (what the band draws: windows plus the moment it is built against), `settings`, `draft` (the settings pane's unapplied edits), `isHidden`.
- `$.store` (kept across sessions): `windows`, `settings`, `isHidden`.
- Colors: `level()` mirrors the extension's rule (usage ≥ utilization danger → Danger; usage − elapsed > danger → Danger; > warning, or usage ≥ utilization warning → Warning). Palette from the desktop app's theme, dark and light.

## tempoc: drawing

- The band above the prompt (`ui.render` `AbovePrompt`) holds one **interactive** `Svg` plus the ⚙ and × `Button`s. Interactive so each line's `<title>` shows as a tooltip and SMIL runs; it then sits in a frame of its own, which:
  - paints an opaque white page unless the markup declares `color-scheme: light dark`;
  - does not stretch (300px by default), so it gets `(bodyColumns − CLOSE_COLUMNS) × CELL_PX` pixels. `CELL_PX` 7.8 errs short (8.4 overflowed in a wide window); the row is `flexWrap="nowrap"` and the Svg's box `overflow="hidden"`, so an overflow clips the bars rather than wrapping the buttons;
  - **reloads, and blinks, whenever its source changes.**
- Against the blinking, the source is built from `view`, not the clock, and stays fixed for up to an hour: the elapsed tick moves by SMIL `<animate>`, and the per-minute texts (time left, tooltip) are drawn ahead for 60 minutes and switched on in turn by SMIL `<set>`. `redraw()` rebuilds `view` and schedules the next rebuild with `untilRedraw`: the earliest of that hour, a reset, or the moment a color threshold is crossed. A new reading rebuilds at once (windows and moment set together, so one reload).
- Sending a prompt remounts the band on the desktop (a blink no mod can avoid), and a remounted frame replays its SMIL from the start, so `prompt.submit` rebuilds to keep that start current. A remount for any other reason (switching sessions) shows texts up to an hour stale until the next rebuild.
- × sets `isHidden`; while hidden, the prompt footer (`SessionMode`) draws one plain hourglass `Button` (U+29D7) that clears it.
- Settings: `Pane` `tempoc-settings`, opened by ⚙ or the `/tempoc` command. One setting per line; the color switch is a `Button` drawn as a checkbox (☑/☐, there is no checkbox element); number `Input`s in fixed-width boxes at the right edge. Edits go to `draft` as typed (`onInput`, no Enter needed); Apply validates all of them and saves the whole `TempocSettings` at once, then redraws; Close discards the draft. Deliberately not plugin.json `userConfig`: `$.config.set` writes one field per call and each write reloads the module.

## What the desktop Code tab allows (found by trial)

- `AbovePrompt` is the only site on the desktop that draws an `Svg`, and it always takes about one row, however thin the drawing.
- The prompt footer (`SessionMode`) takes no room but draws text and `Button`s only: no `Svg`, `display`/`position` on a `Box` are ignored (a hidden hover card shows inline), every `Text` is trimmed (space-only cells vanish), and it is narrow. A bar of glyph cells did not fit; one-glyph vertical meters were tried and found hard to read.
- `PromptHint` is not drawn on the desktop. The desktop app's own chrome (the branch row, the left sidebar, the context ring) and its Chat tab are not mod sites at all. A `Pane` docks beside the transcript.
- A `Button` takes one string; nothing drawn (an `Svg`) can be pressed, and an interactive Svg's frame runs no script. Hover (`<title>`) is the only per-bar interaction.

Re-check these on a newer build: the render sites and what each surface draws may grow.

## Developing

- `claude plugin validate claude-mods` (marketplace) and `claude plugin validate claude-mods/tempoc` (plugin and module) after every change.
- Run from the working tree with `claude --plugin-dir claude-mods/tempoc`.
- Hot reload inside a session: the `plugin-authoring` skill watches a per-session mods folder under `~/.claude/dev-mods/`. **A junction to `claude-mods/tempoc` does not work** (the file watcher does not see changes behind it); copy the four source files there after each edit instead.
- Type-check with the `tsconfig.json` Claude Code writes beside a locally loaded plugin (it extends `.claude-plugin/types/tsconfig.json`; both are git-ignored).
