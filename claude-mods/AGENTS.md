# claude-mods/AGENTS.md

Claude Code mods: plugins of **function hooks**. No build step: Claude Code compiles and runs each plugin's hooks module (`.tsx`) itself, in a sandbox of its own (no DOM, no Node; everything outside goes through the engine interface `$`). The API is early access: its authority is the `claude-code.d.ts` that Claude Code writes for the running build (`/plugin-types`, or the `plugin-authoring` skill). These notes were written against Claude Code 2.1.286.

This directory holds the module's plugins, one per subdirectory. They are distributed through a Claude Code **marketplace** whose catalog is the one file outside this directory: `.claude-plugin/marketplace.json` at the repository root (see below for why).

## Layout

| Path | Role |
|---|---|
| `../.claude-plugin/marketplace.json` | The marketplace, `tempoc`, at the repository root. Each entry's `source` is `git-subdir` (this repo, `claude-mods/<plugin>`), so the catalog also works when added by the raw URL of the file, where a relative source would not |
| `.gitignore` | Drops what Claude Code writes when it loads a plugin from a local folder. The root `.gitignore` re-includes every `.claude-plugin/` (it drops every other dot-path) |
| `usage-bar/.claude-plugin/plugin.json` | Plugin manifest: `name` (must match the marketplace entry's), `version`, `types` |
| `usage-bar/hooks/hooks.json` | Names the one hooks module |
| `usage-bar/hooks/register.tsx` | The module |
| `version` | The next version, the source of truth (see Versioning) |
| `scripts/versionup.py` | Computes the version and writes it to `version` and `usage-bar/.claude-plugin/plugin.json` |
| `scripts/dev_copy.py` | Copies a plugin under another name (`usage-bar-dev`) for development beside the installed one (see Developing) |
| `usage-bar/types/index.d.ts` | Contract for the `$.state` values the module keeps; `claude plugin validate` holds every state key the module names to it |

Why the catalog sits at the repository root: Claude Code reads manifests only from directories named exactly `.claude-plugin/`, and adding a marketplace by repository (`/plugin marketplace add secondarykey/TEMPOC`, or the same from a plugin browser) reads only the repo-root `.claude-plugin/marketplace.json`. No add command takes a path inside the repository; only `extraKnownMarketplaces` in settings does. With the catalog under `claude-mods/`, users had to add it by the file's raw URL, and a plugin browser that adds by repository could not reach it.

Why two `.claude-plugin/` directories: a plugin's folder is copied whole to each user's machine on install, so `usage-bar/` holds only what ships, while the catalog and the module's own documents never ship.

Naming: the marketplace is `tempoc` (the product), and each plugin is named for its feature, so a plugin's id reads `<feature>@tempoc` (today `usage-bar@tempoc`). The directory, the marketplace entry's `name`, `plugin.json`'s `name`, the `plugin` of every `atom` and the `PluginState` key in `types/index.d.ts` all carry that same feature name; the settings command takes it too (`/usage-bar`). Renaming a plugin changes its id, so users reinstall it, and what it kept in `$.store` may not carry over.

## Versioning

`version` is the source of truth; `usage-bar/.claude-plugin/plugin.json` carries a copy, because that is where Claude Code reads the plugin's version, and users receive a change only when that value changes (Claude Code keeps an installed copy per version and ignores new commits under the same one).

`.github/workflows/versionup-mods.yml` runs on a push to `main` that touches `usage-bar/**` or `version`: `scripts/versionup.py` keeps an untagged `version` or bumps the patch of a tagged one, writes both files, merges the bump through a PR, and tags `mods-v<version>`. There is no release workflow: the bump reaching `main` is the release. Edit `version` by hand to start a minor or major one. A change to the catalog (`../.claude-plugin/`) or the docs alone is no release.

## usage-bar: data

- Readings: `$.session.usage().rateLimits` at `session.start`, then `session.measure` whenever a window moves a whole point. Each window is `{ kind, percentUsed, resetsAt }`; `kind` is `five_hour` / `seven_day` (or a gateway's `spend_limit`, drawn without elapsed time). Elapsed % = `(span − (resetsAt − now)) / span`.
- State (`types/index.d.ts`): `windows` (latest reading), `view` (what the band draws: windows plus the moment it is built against), `settings`, `draft` (the settings pane's unapplied edits), `isHidden`.
- `$.store` (kept across sessions): `windows`, `settings`, `isHidden`.
- Colors: `level()` mirrors the extension's rule (usage ≥ utilization danger → Danger; usage − elapsed > danger → Danger; > warning, or usage ≥ utilization warning → Warning). Palette from the desktop app's theme, dark and light.

## usage-bar: drawing

- The band above the prompt (`ui.render` `AbovePrompt`) holds one **interactive** `Svg` plus the ⚙ and × `Button`s. Interactive so each line's `<title>` shows as a tooltip and SMIL runs; it then sits in a frame of its own, which:
  - paints an opaque white page unless the markup declares `color-scheme: light dark`;
  - does not stretch (300px by default), so it gets `bodyColumns × CELL_PX − BUTTONS_PX` pixels: a cell is 8.4px (the 14px code font), while the ⚙ and × buttons take a fixed ~63px that does not scale with the cells. Taking the buttons off as cells instead (7 cells) left the Svg short by more the wider the window, or, at 8.4px a cell, overflowed by a few pixels. An overflow must clip the bars, not wrap the gear onto a second line, which `flexWrap="nowrap"` on the row alone did not prevent: see the button layout below;
  - **reloads, and blinks, whenever its source changes.**
- Button layout, found by trial: the × (`role="dismiss"`) must be a direct child of the band's row, where the desktop draws it as the band's own close control; inside a Box of ours it gets a boxed button's frame. With it there, the desktop lays the row's other children out in a container of its own that wraps whatever `flexWrap` says, so the Svg's box (`minWidth={0}`, `overflow="hidden"`) and the gear's (`flexShrink={0}`) go together in one Box of ours, which keeps them on one line. `marginRight={-1}` on the gear's Box pulls it one cell toward the ×.
- Against the blinking, the source is built from `view`, not the clock, and stays fixed for up to an hour: the elapsed tick moves by SMIL `<animate>`, and the per-minute texts (time left, tooltip) are drawn ahead for 60 minutes and switched on in turn by SMIL `<set>`. `redraw()` rebuilds `view` and schedules the next rebuild with `untilRedraw`: the earliest of that hour, a reset, or the moment a color threshold is crossed. A new reading rebuilds at once (windows and moment set together, so one reload).
- Sending a prompt remounts the band on the desktop (a blink no mod can avoid), and a remounted frame replays its SMIL from the start, so `prompt.submit` rebuilds to keep that start current. A remount for any other reason (switching sessions) shows texts up to an hour stale until the next rebuild.
- × sets `isHidden`; while hidden, the prompt footer (`SessionMode`) draws one plain hourglass `Button` (U+29D7) that clears it.
- Settings: `Pane` `tempoc-settings`, opened by ⚙ or the `/usage-bar` command. One setting per line, the label on the left and the control in a fixed-width box at the right edge: the color switch is a `Select` of Color on / Color off beside the window's heading (there is no toggle or checkbox element; a `Button` drawn as ☑/☐ was the first try; plain On / Off beside the heading read as showing the window or not), the thresholds number `Input`s. Utilization Threshold has no switch of its own, as in the other editions: a window's color switch stops all its coloring. Edits go to `draft` as typed (`onInput`, no Enter needed); Apply validates all of them and saves the whole `TempocSettings` at once, then redraws; Close discards the draft. Deliberately not plugin.json `userConfig`: `$.config.set` writes one field per call and each write reloads the module.

## What the desktop Code tab allows (found by trial)

- `AbovePrompt` is the only site on the desktop that draws an `Svg`, and it always takes about one row, however thin the drawing.
- The prompt footer (`SessionMode`) takes no room but draws text and `Button`s only: no `Svg`, `display`/`position` on a `Box` are ignored (a hidden hover card shows inline), every `Text` is trimmed (space-only cells vanish), and it is narrow. A bar of glyph cells did not fit; one-glyph vertical meters were tried and found hard to read.
- `PromptHint` is not drawn on the desktop. The desktop app's own chrome (the branch row, the left sidebar, the context ring) and its Chat tab are not mod sites at all. A `Pane` docks beside the transcript.
- A `Button` takes one string; nothing drawn (an `Svg`) can be pressed, and an interactive Svg's frame runs no script. Hover (`<title>`) is the only per-bar interaction.

Re-check these on a newer build: the render sites and what each surface draws may grow.

## Developing

- `claude plugin validate .` from the repository root (marketplace) and `claude plugin validate claude-mods/usage-bar` (plugin and module) after every change.
- Run from the working tree with `claude --plugin-dir claude-mods/usage-bar`.
- Hot reload inside a session: the `plugin-authoring` skill watches a per-session mods folder under `~/.claude/dev-mods/`. **A junction to `claude-mods/usage-bar` does not work** (the file watcher does not see changes behind it); copy the source files there after each edit instead.
- **Copy under another name.** A copy loaded under the plugin's own name (hot reload or `--plugin-dir`) takes the installed `usage-bar@tempoc`'s place in that session: nothing is uninstalled, other sessions keep the installed version, but this one shows only the copy. To keep the installed version in view beside the copy (to compare, or to watch an update arrive), make the copy with `scripts/dev_copy.py`, which renames every identifier the name is (manifest, state contract, atoms, command, settings pane) to `usage-bar-dev`:

  ```bash
  python3 claude-mods/scripts/dev_copy.py ~/.claude/dev-mods/<session id>
  ```

  Run it again after each edit; the hot reload picks the copy up when the turn ends. The session then draws two bands, the installed one and the copy's, each with its own settings (`/usage-bar`, `/usage-bar-dev`). `--plugin-dir` takes the same copy: `python3 claude-mods/scripts/dev_copy.py <folder>`, then `claude --plugin-dir <folder>/usage-bar-dev`. Never load a copy as `usage-bar` beside the installed plugin.
- Which copy is drawing: the settings pane's title reads `TEMPOC v<version>` from the copy's own `plugin.json`, with `local` after it when it was not installed from a marketplace (its root is not under `plugins/cache/`). The desktop shows the title on the docked pane; the terminal draws a pane's title only as a tab, when more than one pane is open.
- Type-check with the `tsconfig.json` Claude Code writes beside a locally loaded plugin (it extends `.claude-plugin/types/tsconfig.json`; both are git-ignored).
