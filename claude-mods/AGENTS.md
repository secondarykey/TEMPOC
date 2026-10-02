# claude-mods/AGENTS.md

Claude Code mods: plugins of **function hooks**. No build step: Claude Code compiles and runs each plugin's hooks module itself, in its own sandbox (no DOM, no Node; everything outside goes through `$`).

This directory is both the module and its distribution: it is a Claude Code **marketplace** (`.claude-plugin/marketplace.json`) whose plugins live in subdirectories. Everything the module needs stays under `claude-mods/`.

## Layout

| Path | Role |
|---|---|
| `.claude-plugin/marketplace.json` | The marketplace, `tempoc`. Each entry's `source` is `git-subdir` (this repo, `claude-mods/<plugin>`), so the catalog also works when added by its raw URL, where a relative source would not |
| `.gitignore` | Re-includes `.claude-plugin/` (the root `.gitignore` drops every dot-path) and drops what Claude Code writes when loading a plugin locally |
| `tempoc/.claude-plugin/plugin.json` | Plugin manifest: name `tempoc` (must match the marketplace entry's `name`), version, `types` contract |
| `tempoc/hooks/hooks.json` | Names the one hooks module |
| `tempoc/hooks/register.tsx` | The module: reads rate-limit windows, draws one full-width SVG in the band above the prompt (`AbovePrompt`): 5h on the left half, 7d on the right |
| `tempoc/types/index.d.ts` | Contract for the `$.state` values the module keeps |

Claude Code reads manifests only from directories named exactly `.claude-plugin/`; the name cannot change. `/plugin marketplace add owner/repo` reads only a repo-root `.claude-plugin/`, which is why users add this marketplace by the raw URL of its `marketplace.json` instead (see `README.md`).

## tempoc: how it works

- Data: `$.session.usage().rateLimits` at `session.start`, then `session.measure` whenever a window moves. Each window is `{ kind, percentUsed, resetsAt }`; `kind` is `five_hour` / `seven_day` (or a gateway's `spend_limit`, shown without elapsed time).
- Elapsed % = `(span − (resetsAt − now)) / span`; `now` is redrawn every 30 s from `$.clock.every`.
- The last reading is mirrored to `$.store` so a fresh session draws before its first response.
- Status: **prototype, on hold.** Every placement either takes a row or cannot draw a bar (below); the band is the least bad. Revisit when the mod API gains a site that draws graphics without taking room.
- Placement: the band above the prompt (`AbovePrompt`) is the only site on the desktop that draws an `Svg`, and it always takes about one row, however thin the drawing. The prompt footer (`SessionMode`) takes no room but cannot hold a bar. On the desktop it draws text only (no `Svg`, no hidden or absolute `Box`), trims every `Text` (so space-only cells vanish) and is narrow, so a bar of cells does not fit, and one-glyph vertical meters were tried and found hard to read. An interactive Svg (for `<title>` tooltips) gets a white frame, so the bars carry no hover figures. The desktop app's own chrome (the branch row, the left sidebar, the context ring) and its Chat tab are not mod sites; a `Pane` docks beside the transcript. `PromptHint` is not drawn on the desktop at all.
- Color thresholds mirror the extension's defaults (`WARNING_AT`, `DANGER_AT`, `UTILIZATION_*`). Not configurable yet.

## Checking

```
claude plugin validate claude-mods
claude plugin validate claude-mods/tempoc
```

To run it from the working tree: `claude --plugin-dir claude-mods/tempoc`. The API is early access; its authority is the `claude-code.d.ts` that Claude Code writes for the running build (`/plugin-types`). These notes were written against Claude Code 2.1.286; re-check the render sites on a newer build before resuming.
