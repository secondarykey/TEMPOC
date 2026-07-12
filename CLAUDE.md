# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TEMPOC is a Manifest V3 Chrome extension that enhances the Claude.ai usage page (`https://claude.ai/new#settings/usage`) by adding progress bars showing elapsed time through the 7-day and 5-hour usage windows, with configurable color thresholds and an options page.

## Desktop App (Wails)

`desktop/` contains a standalone **Wails v3 desktop app** that provides the same functionality as a native window instead of a page enhancement. It loads claude.ai inside a hidden WebView, intercepts the usage API the same way the extension does, and renders the progress bars in its own frameless React UI. It surfaces what claude.ai itself doesn't show: exactly which day and hour each window resets. It also ports all of the extension's settings (persisted to `%APPDATA%\TEMPOC\settings.json`) plus desktop-only options: a locale selector, always-on-top, and a fully transparent window mode (on/off).

**The rest of this file documents the Chrome extension. For anything about the desktop app — architecture, the usage-interception mechanism, the two-window design, settings, the frameless title bar, transparency, build commands, and known constraints — see [`desktop/CLAUDE.md`](desktop/CLAUDE.md).**

## Installation & Testing

There is no build step. To install for development:

1. Open `chrome://extensions/` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select the **`src/`** directory
4. Visit `https://claude.ai/settings/usage` to see the extension in action

To reload after changes, click the refresh icon on the extension card in `chrome://extensions/`.

## Architecture

### Files

Extension files live in `src/`. The desktop app lives in `desktop/` (see `desktop/CLAUDE.md`); the repo root also holds `README.md` and this `CLAUDE.md`.

| File | World | Role |
|---|---|---|
| `src/manifest.json` | — | Extension declaration |
| `src/bridge.js` | ISOLATED | Reads `chrome.storage` and forwards settings to MAIN world via custom events |
| `src/content.js` | MAIN | Injects UI and intercepts `window.fetch` |
| `src/options.html` / `src/options.js` | Options page | Settings UI |
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

### Colors

Theme colors are defined as CSS variables in `options.html` and used in `options.js` for the dual-range slider gradient. The progress bar in `content.js` uses Claude's own CSS classes (`bg-fill-danger`, `bg-fill-warning`, `bg-fill-accent`) for danger/warning/normal states.

```css
:root {
  --color-accent:  #7dd3fc;
  --color-warning: #fbbf24;
  --color-danger:  #ef4444;
}
```
