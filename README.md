# TEMPOC

TEMPOC shows how far you are through Claude's usage windows.

claude.ai tells you how much of each window you have consumed, but not how much of the window's *time* has elapsed, nor exactly when it resets. TEMPOC answers both, so you can pace yourself and plan ahead instead of guessing.

## Two ways to use it

Pick whichever fits how you work. Both read the same data from claude.ai and show the same bars; they differ only in where the bars live.

| | What it is | Guide |
|---|---|---|
| **Chrome extension** | Adds the bars directly to the claude.ai usage page you already open | [`chrome-extension/`](chrome-extension/README.md) |
| **Desktop app** | A standalone, compact window (Windows) that stays visible while you work, without keeping a claude.ai tab open | [`desktop/`](desktop/README.md) |

They are independent: install either, or both. Each has its own versions and releases — see the [Releases page](https://github.com/secondarykey/TEMPOC/releases), where extension builds are tagged `extension-v*` and desktop builds `desktop-v*`.

## Elapsed time and amount used

Each bar fills to show **how much you have used**, and a marker shows **how far through the window's time you are**. Comparing the two is the point: usage ahead of elapsed time means you are burning the window faster than the clock.

When usage outpaces elapsed time, the bar changes color in two stages — Warning and Danger — so you can spot overconsumption at a glance. If usage is higher still, the bar turns Danger color. As time passes and the window progresses, the bar returns to its normal color.

Color thresholds can be adjusted or disabled in the settings of either version.

## Website

https://secondarykey.github.io/TEMPOC/

## Claude

TEMPOC is an unofficial tool and is not affiliated with or endorsed by Anthropic or Claude.

## Privacy

**100% client-side.** TEMPOC processes data only on your own machine — in your browser (extension) or in the app's own window (desktop). No data is ever collected or transmitted to external servers. TEMPOC reads the usage figures claude.ai returns to you and nothing else.

**Where your claude.ai session lives.** The extension adds nothing here: it runs inside Chrome and uses the session you are already signed in with. The desktop app is different — it asks you to log in to claude.ai in its own window, and that session is stored on your machine in the app's private WebView profile, separate from your browser. That is what lets it read your usage without a browser tab open. If that trade-off matters to you, the desktop README explains [how to verify the login page is genuine](desktop/README.md#trust-how-do-you-know-the-login-page-is-real).

**Verifiable code.** To ensure full transparency, the source code is public. Anyone can inspect how TEMPOC handles data.

## Disclaimer

**Dependence on the target website.** TEMPOC relies on the current behaviour of claude.ai — specifically its usage API, and, for the Chrome extension, the design of the usage page. If the website changes, TEMPOC may stop working or cause layout issues.

**In case of issues.** If you experience any display problems or malfunctions, please disable or remove the extension, or close the desktop app, immediately.

**Disclaimer of liability.** The developer shall not be held responsible for any issues or damages caused by the use of this software. Use at your own risk.

## License

MIT — see [LICENSE](LICENSE).
