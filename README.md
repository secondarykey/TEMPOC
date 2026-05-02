# TEMPOC

TEMPOC is a Google Chrome Extension that displays elapsed time progress bars on Claude's usage page (`https://claude.ai/settings/usage`), showing how far through the current 5-hour and 7-day usage windows you are.

## Installation

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `src/` directory

## Settings

Click the extension icon → **Options** to configure:

- Show/hide each progress bar
- Warning and danger thresholds (dual-range slider, -50 to +50)
- Show remaining time
- Decimal places (0–3)
- Duration style (narrow / short / long)
- Percent format (custom string with `{}` placeholder)
- Auto-refresh interval
