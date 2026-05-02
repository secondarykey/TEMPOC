# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TEMPOC is a Manifest V3 Chrome extension that enhances the Claude.ai usage page (`https://claude.ai/settings/usage`) by adding progress bars showing weekly (7-day) and 5-hour usage window percentages.

## Installation & Testing

There is no build step. To install for development:

1. Open `chrome://extensions/` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory
4. Visit `https://claude.ai/settings/usage` to see the extension in action

To reload after changes, click the refresh icon on the extension card in `chrome://extensions/`.

## Architecture

The extension consists of two files:

- **`manifest.json`** — Declares the extension with `world: "MAIN"` so `content.js` runs in the page's JavaScript context (required to intercept `window.fetch`)
- **`content.js`** — All extension logic in a single content script

### How content.js works

**UI injection**: `createElement()` clones an existing progress bar element from Claude's DOM and inserts it after the original. Two elements are injected: one for the 7-day window (`day7Progress`) and one for the 5-hour window (`hour5Progress`). It uses `waitForElement()` with a `MutationObserver` to handle Claude's SPA navigation.

**Data extraction**: `window.fetch` is monkey-patched to intercept two API endpoints:
- `/api/organizations/[id]/usage` — returns `seven_day` and `five_hour` objects with `utilization` (percentage used) and `resets_at` (ISO timestamp)
- `/api/account_profile` — returns `locale` for localized date/duration formatting

**Rendering** (`redraw()`): Computes elapsed time percentage through the current window, updates the cloned progress bar's width, and color-codes it:
- `bg-fill-danger` — usage exceeds time elapsed by >10%
- `bg-fill-warning` — usage exceeds time elapsed by 0–10%
- `bg-fill-accent` — usage is at or below time elapsed

The 7-day bar also shows remaining time via `Intl.DurationFormat`. Locale is set from the account profile API response, falling back to `document.documentElement.lang`.

### Key DOM selectors

These CSS path selectors target Claude's existing progress bar sections and are fragile — they will break if Claude changes its page structure:

```js
const Day7ElementPATH = "main > div > div > div > section:nth-child(2) > div:nth-child(2) > div > div:nth-child(2)";
const Hour5ElementPATH = "main > div > div > div > section:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div";
```
