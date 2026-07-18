# chrome-extension/CLAUDE.md

This file documents the **Chrome extension** — one of the two modules in this repository. For the desktop app see [`../desktop/CLAUDE.md`](../desktop/CLAUDE.md); for the repo-wide layout see [`../CLAUDE.md`](../CLAUDE.md).

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

Release tags for this module are `extension-v*` (e.g. `extension-v1.3.0`), and `.github/workflows/release-extension.yml` zips `src/` on those tags. Releases from before the repo split into modules were tagged `v*` (up to `v1.2.6`); those tags stay as they are and no longer trigger anything, but `versionup.py` still recognises them (`is_released()`) so that an already-released version is never re-released.

**`version` holds the version to release next, not the last one released.** `versionup.py` bumps the patch only if that value is already tagged; otherwise it keeps it. So a minor or major release is started by editing `version` (and `src/manifest.json`) by hand — CI then releases exactly that value and has nothing to commit. Note that this path produces **no file diff**, which is why `versionup-extension.yml`'s tag step must not be gated on the change check; gating it there would silently skip the release. `1.3.0` was cut this way, for the split into modules.

| File | World | Role |
|---|---|---|
| `src/manifest.json` | — | Extension declaration |
| `src/bridge.js` | ISOLATED | Reads `chrome.storage` and forwards settings to MAIN world via custom events |
| `src/content.js` | MAIN | Injects UI and intercepts `window.fetch` |
| `src/options.html` / `src/options.js` | Options page | Settings UI |
| `src/i18n.js` | Options page | Locale resolution and message loading/applying for the options page |
| `src/locales/*.json` | Options page | UI strings, one file per locale. **Synced copies of the repo-root `locales/` master — never edit here** (see the root `CLAUDE.md`, "Shared locale resources") |
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

### Key DOM selectors

These CSS path selectors target Claude's existing progress bar sections within the Settings dialog and are fragile — they will break if Claude changes its page structure:

```js
const DialogSectionsPATH = '[role="dialog"] > div:nth-child(2) > div:last-child > div:last-child';
const Hour5ElementPATH = DialogSectionsPATH + " > section:nth-child(1) > div:nth-child(2) > div > div";
const Day7ElementPATH  = DialogSectionsPATH + " > section:nth-child(2) > div:nth-child(2) > div > div:nth-child(2)";
```

The usage page is now rendered as a modal dialog at `https://claude.ai/new#settings/usage` (previously a full page at `/settings/usage`). Section 1 = "Current session" (5-hour window), Section 2 = "Weekly limits" (7-day window).

### Options page i18n

Only the options page has translatable strings — the injected bars render dates and durations via `Intl` and carry no fixed text. `chrome.i18n` / `_locales` is deliberately **not** used: its language is pinned to the browser UI language, while TEMPOC follows the user's claude.ai display language.

- **Locale selection**: `content.js` intercepts `/api/account_profile` and dispatches the account `locale`; `bridge.js` stores it as `chrome.storage.local.detectedLocale` (this relay predates i18n — the options page already used it for `Intl` preview formatting). `options.js` resolves it with `tempocResolveLocale()` (exact match → primary-language match → `en-US`) and falls back to `navigator.language` when claude.ai has not been visited yet.
- **Applying**: elements carry `data-i18n="key"` attributes; `tempocApplyI18n()` replaces their text once the locale JSON is fetched. The English text baked into `options.html` is the pre-load fallback and must be kept in sync with `locales/en-US.json`.
- **Loading**: `i18n.js` fetches `locales/<code>.json` relative to the options page (extension pages may fetch their own packaged resources; no `web_accessible_resources` needed). Supported codes are listed in `TEMPOC_LOCALES`, which must match the desktop's `SUPPORTED_LOCALES`.
- **Adding a language or key**: edit the repo-root `locales/` master and run `python3 scripts/sync_locales.py`; for a new language also add its code to `TEMPOC_LOCALES` (and the desktop's `SUPPORTED_LOCALES`). Key parity across locales is enforced by the sync script (there is no build step here to catch it).

### Colors

Theme colors are defined as CSS variables in `options.html` and used in `options.js` for the dual-range slider gradient. The progress bar in `content.js` uses Claude's own CSS classes (`bg-fill-danger`, `bg-fill-warning`, `bg-fill-accent`) for danger/warning/normal states.

```css
:root {
  --color-accent:  #7dd3fc;
  --color-warning: #fbbf24;
  --color-danger:  #ef4444;
}
```
