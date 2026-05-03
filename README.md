# TEMPOC

This extension displays elapsed-time progress bars for Claude's 7-day and 5-hour usage windows. It can also show the reset date and remaining time.

Monitor your usage and plan ahead to get the most out of Claude.

## Installation

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `src/` directory

## Elapsed time and amount used

When your usage outpaces elapsed time, the bar changes color in two stages — Warning and Danger — so you can spot overconsumption at a glance.

If usage is even higher, the bar turns Danger color.

As time passes and the window progresses, the bar returns to its normal color.

Color thresholds can be disabled or adjusted in the options.

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

## Claude

This extension is an unofficial tool and is not affiliated with or endorsed by Anthropic or Claude.

## Privacy

100% Client-Side: This extension processes data only within your browser. No data is ever collected or transmitted to external servers.

Verifiable Code: To ensure full transparency, the source code is public. Anyone can inspect how the extension handles data.

## Disclaimer

Dependence on Page Design: This extension relies on the current design of the target website. If the website updates its UI, this extension may stop working or cause layout issues.

In Case of Issues: If you experience any display problems or malfunctions, please disable or remove the extension immediately.

Disclaimer of Liability: The developer shall not be held responsible for any issues or damages caused by the use of this software. Use at your own risk.
