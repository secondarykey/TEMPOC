# TEMPOC for Chrome

A Chrome extension that adds elapsed-time progress bars to the Claude.ai usage page, so you can see how far through each window you are and exactly when it resets.

It enhances the page you already use: open `https://claude.ai/new#settings/usage` as usual and the bars appear inline. For a standalone window that stays visible while you work, see [TEMPOC Desktop](../desktop/README.md) instead.

For what the bars mean and how the colors work, see the [project README](../README.md).

## Installation

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `chrome-extension/src/` directory

Released versions are published as a zip on the [Releases page](https://github.com/secondarykey/TEMPOC/releases) (tagged `extension-v*`).

## Options

Click the extension icon → **Options** to configure:

### General Settings

- Duration style: Controls how remaining time is formatted.
- Decimal places: Sets the number of decimal places in the percentage display.
- Percent format: Normally displays as "50%", but can be changed to "50% elapsed", etc.

### Window Settings

- Show: Hides the elapsed-time bar for each window.
- Show remaining time: Toggles the remaining-time label.
- Color threshold: Disables color changes when turned off.
- Warning & Danger: Sets the thresholds for color changes.

### Locale

The options screen is in English only, but dates and durations are displayed in the language configured in your Claude account.

## Development

There is no build step — `src/` is the extension. After changing it, click the refresh icon on the extension card in `chrome://extensions/`.

For architecture details (the two-world content script design, the fetch interception, the release pipeline), see [`CLAUDE.md`](CLAUDE.md).
