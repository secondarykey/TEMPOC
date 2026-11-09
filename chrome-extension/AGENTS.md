# chrome-extension/AGENTS.md

This file documents the **Chrome extension** — one of the two modules in this repository. For the desktop app see [`../desktop/AGENTS.md`](../desktop/AGENTS.md); for the repo-wide layout see [`../AGENTS.md`](../AGENTS.md).

## Project Overview

TEMPOC is a Manifest V3 Chrome extension that enhances the Claude.ai usage page (`https://claude.ai/new#settings/usage`) by adding progress bars showing elapsed time through the 7-day and 5-hour usage windows, with configurable color thresholds and an options page.

## Installation & Testing

There is no build step. To install for development:

1. Open `chrome://extensions/` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select the **`chrome-extension/src/`** directory
4. Visit `https://claude.ai/settings/usage` to see the extension in action

To reload after changes, click the refresh icon on the extension card in `chrome://extensions/`.

## Architecture

### Files

Everything in this section is relative to `chrome-extension/`. The loadable extension itself is `src/`; the sibling directories hold release tooling rather than shipped code.

| Path | Role |
|---|---|
| `src/` | The extension. This is what "Load unpacked" points at and what the release zip contains |
| `version` | Single source of truth for the extension version. `scripts/versionup.py` writes it and mirrors it into `src/manifest.json` |
| `scripts/versionup.py` | Run by `.github/workflows/versionup-extension.yml` on pushes to `main` that touch `chrome-extension/**`. Resolves its paths from its own location, so it works from any cwd |
| `store-assets/` | Chrome Web Store listing images. Not part of the zip |

Tags, the "`version` holds the *next* version" rule and the release pipeline are shared with the desktop and described once in the root [`AGENTS.md`](../AGENTS.md#versioning). What is specific to this module:

- A hand-edited minor/major bump must change **both** `version` and `src/manifest.json`.
- `versionup.py` still recognises the pre-split `v*` tags (`is_released()`), so an already-released version is never re-released.
- A hand-edited bump produces **no file diff** in CI (the value is used as-is), so `versionup-extension.yml`'s tag step must not be gated on the change check — gating it would silently skip the release.

| File | World | Role |
|---|---|---|
| `src/manifest.json` | — | Extension declaration |
| `src/bridge.js` | ISOLATED | Reads `chrome.storage` and forwards settings to MAIN world via custom events |
| `src/content.js` | MAIN | Injects UI and intercepts `window.fetch` |
| `src/options.html` / `src/options.js` | Options page | Settings UI |
| `src/i18n.js` | Options page | Locale resolution and message loading/applying for the options page |
| `src/locales/*.json` | Options page | UI strings, one file per locale. **Synced copies of the repo-root `locales/` master — never edit here** (see the root `AGENTS.md`, "Shared locale resources") |
| `src/tempoc.png` | — | Extension icon |

`content.js` must run in `world: "MAIN"` to monkey-patch `window.fetch`. Since MAIN world cannot access `chrome.storage` or `chrome.runtime`, `bridge.js` runs in ISOLATED world as a relay.

### Settings flow

```
options.js
  input event  → chrome.tabs.sendMessage → bridge.js: onMessage
  change event → chrome.storage.sync.set → bridge.js: onChanged
                                                ↓
                              window.dispatchEvent("tempoc:settings-changed")
                                                ↓
                                        content.js: applySettings()
```

On initial page load, `bridge.js` reads storage and fires `tempoc:settings` (one-time).

### How content.js works

**UI injection**: `createElement()` clones an existing Claude progress bar from the DOM and inserts it after the original. Two elements are injected: `day7Progress` (7-day window) and `hour5Progress` (5-hour window). `waitForElement()` uses a `MutationObserver` to handle Claude's SPA navigation.

**Data extraction**: `window.fetch` is monkey-patched to intercept:
- `/api/organizations/[id]/usage` — returns `seven_day` and `five_hour` objects with `utilization` (%) and `resets_at` (ISO timestamp)
- `/api/account_profile` — returns `locale` for localized formatting

**Rendering** (`redraw(elm, obj, dangerAt, warningAt)`): Computes elapsed time percentage through the window, updates bar width, and color-codes using Claude's own CSS classes:
- `bg-fill-danger` — `(utilization - elapsed%) > dangerAt`
- `bg-fill-warning` — `(utilization - elapsed%) > warningAt`
- `bg-fill-accent` — otherwise

### Settings reference

All settings are stored in `chrome.storage.sync`. Defaults are defined identically in both `bridge.js` and `options.js`.

| Key | Default | Description |
|---|---|---|
| `showDay7` | `true` | Show 7-day progress bar |
| `showHour5` | `true` | Show 5-hour progress bar |
| `day7Danger` / `day7Warning` | `10` / `0` | Color thresholds for 7-day bar (-50–50) |
| `hour5Danger` / `hour5Warning` | `10` / `0` | Color thresholds for 5-hour bar (-50–50) |
| `showRemainDay7` | `true` | Show remaining time on 7-day bar |
| `showRemainHour5` | `false` | Show remaining time on 5-hour bar |
| `decimalPlaces` | `2` | Percentage decimal places (0–3) |
| `durationStyle` | `'short'` | `Intl.DurationFormat` style: `narrow`/`short`/`long` |
| `percentFormat` | `'{}%'` | Display format; `{}` is replaced with the number |
| `refreshInterval` | `0` | Auto-refresh interval in minutes (0 = disabled) |

### Locating the usage rows

The injected bars are clones of Claude's own usage rows, so `content.js` has to find those rows in a DOM it does not control. It no longer uses a CSS path:

```js
const MeterSelector = '[role="dialog"] [role="meter"]';
findUsageRows();  // -> { hour5, day7 } | null
```

The usage page is a modal dialog at `https://claude.ai/new#settings/usage` (previously a full page at `/settings/usage`); that URL and the `/api/organizations/<id>/usage` endpoint have both stayed put through every redesign so far.

**Why `role="meter"` and not a path.** Every earlier selector pinned some part of the dialog's shape and every one of them eventually broke:

| When | What claude.ai changed | What broke |
|---|---|---|
| Jul 2026 | Prepended a "Your limits are temporarily boosted." banner to a section | `nth-child` row position — fixed by matching the row's meter markup with `:has()` |
| Aug 2026 | Inserted another wrapper div above the sections | The `> div:last-child` chain — fixed with `div:has(> section)` |
| Sep 2026 | Rebuilt the dialog on CDS components: both usage rows moved into **one** section (section 2 is now "Usage credits"), and the meter gained wrapper divs | Every remaining path selector at once |
| Nov 2026 | Made "This week" a disclosure: the row is now wrapped in `[row, breakdown panel]`, and its meter gained an overlay `<span>` (the per-model share) next to the fill | "The row is the direct child of the two meters' common ancestor" — it picked the wrapper, the clone threw on the missing second column, and the 7-day bar vanished |

The only thing that has survived all of it is the meter's ARIA contract: the fill's container carries `role="meter"` with `aria-valuenow` / `aria-valuetext`. So that is the single anchor now, and the row is derived from it structurally:

1. Collect the dialog's meters, skipping anything inside `[data-tempoc]` (TEMPOC's own clones also contain a meter).
2. Take the first two in DOM order — 5-hour ("Current session"), then 7-day ("This week"). Extra weekly rows per model family sort after these two, so they are skipped naturally. That is intended: the injected bar shows *elapsed time through the window*, and every weekly row shares one window.
3. For each meter, `rowOf()` climbs until the branch it came from has a preceding element sibling; that parent is the row. Inside the meter column the meter's branch comes first, inside the row it comes after the title column, so this stops exactly at the row.

No class name, no `nth-child`, no fixed depth, and nothing about what surrounds a row — each row is found from its own meter, so wrappers around a single row (the "This week" disclosure) or the rows landing in separate containers do not matter. `MaxRowDepth` caps the climb at 8 levels, and `createElement()` refuses a row that does not have the two columns below: if the shape changes, nothing is injected rather than a broken clone.

**Where the clone goes.** Directly after its row (`row.after(clone)`), so the 7-day clone sits *inside* the disclosure wrapper, between the row and the breakdown panel. The rows are spaced by the row container's `gap`, which does not reach inside that wrapper, so `missingRowGap()` copies the amount onto the clone as `margin-top` whenever the row's direct parent has no gap of its own.

**Row shape assumed downstream.** `createElement()` clones a row and `redraw()` rewrites it, both relying on the row having two element children:

| | Original row | In the clone |
|---|---|---|
| `divs[0]` | `[title, "Resets at 12:40 PM"]` | title removed; `children[0]` becomes the reset-time line |
| `divs[1]` | `[meter block, "63% used"]` | `children[1]` becomes the elapsed percentage |

The fill bar is reached with `fillBarOf()` (`[role="meter"]` → first element child), never by an index chain — that chain is exactly what the CDS rewrite lengthened. The clone's stale `aria-valuenow` / `aria-valuetext` / `aria-labelledby` are stripped on creation and the first two are re-set to the elapsed values by `redraw()`, so screen readers do not read the usage percentage twice. Any other child of the cloned meter (the weekly per-model overlay) is removed: it would sit on top of the elapsed fill and means nothing there.

**Fill is a transform, not a width.** Claude renders the fill full-width and offsets it: `transform: translateX(calc(var(--_meter-dir, -1) * (100% - ...)))`. `redraw()` matches that with `width: 100%` plus its own `translateX(-N%)`; writing `width` instead would leave the cloned `translateX` in place and shift the bar left.

**Colors.** The original bar's class is re-asserted by a `MutationObserver` because React re-renders overwrite it. The observer resolves the bar through `originalBar(id)` on every callback rather than holding a node, since the re-render may replace it.

### Options page i18n

Only the options page has translatable strings — the injected bars render dates and durations via `Intl` and carry no fixed text. `chrome.i18n` / `_locales` is deliberately **not** used: its language is pinned to the browser UI language, while TEMPOC follows the user's claude.ai display language.

- **Locale selection**: `content.js` intercepts `/api/account_profile` and dispatches the account `locale`; `bridge.js` stores it as `chrome.storage.local.detectedLocale` (this relay predates i18n — the options page already used it for `Intl` preview formatting). `options.js` resolves it with `tempocResolveLocale()` (exact match → primary-language match → `en-US`) and falls back to `navigator.language` when claude.ai has not been visited yet.
- **Applying**: elements carry `data-i18n="key"` attributes; `tempocApplyI18n()` replaces their text once the locale JSON is fetched. The English text baked into `options.html` is the pre-load fallback and must be kept in sync with `locales/en-US.json`.
- **Loading**: `i18n.js` fetches `locales/<code>.json` relative to the options page (extension pages may fetch their own packaged resources; no `web_accessible_resources` needed). Supported codes are listed in `TEMPOC_LOCALES`, which must match the desktop's `SUPPORTED_LOCALES`.
- **Adding a language or key**: follow the [`tempoc-i18n`](../docs/skills/tempoc-i18n/SKILL.md) skill. Key parity across locales is enforced by the sync script (there is no build step here to catch it).

### Colors

Theme colors are defined as CSS variables in `options.html` and used in `options.js` for the dual-range slider gradient. The progress bar in `content.js` uses Claude's own CSS classes (`bg-fill-danger`, `bg-fill-warning`, `bg-fill-accent`) for danger/warning/normal states.

```css
:root {
  --color-accent:  #7dd3fc;
  --color-warning: #fbbf24;
  --color-danger:  #ef4444;
}
```
