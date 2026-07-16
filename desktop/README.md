# TEMPOC Desktop

A standalone desktop app (Wails v3, Windows / WebView2) that shows elapsed-time progress bars for Claude's 5-hour and 7-day usage windows — including exactly when each window resets, which claude.ai itself doesn't display.

It works by loading claude.ai inside a hidden WebView, intercepting the usage API responses, and rendering the bars in its own compact, frameless window. All of the [Chrome extension](../chrome-extension/README.md)'s settings are available, plus desktop-only options (locale, always-on-top, transparent window, size modes).

For what the bars mean, and for privacy and disclaimer, see the [project README](../README.md).

## Installing

Download the zip from the [Releases page](https://github.com/secondarykey/TEMPOC/releases) (tagged `desktop-v*`) and run `tempoc.exe` — there is no installer. On first launch you will be asked to log in to claude.ai (see below).

## Logging in

The app needs an authenticated claude.ai session inside its WebView to read your usage. When no session exists, the main window shows a **Log in to Claude** button; clicking it opens a window with claude.ai's own login page. Once you finish logging in, the window hides itself and the bars appear — you never need to open the usage page manually.

The login window shows the current URL in two places: a read-only address bar overlaid along the bottom of the page, and the native window title.

## Trust: how do you know the login page is real?

Honestly: **an embedded login window can never fully prove itself.** The address bar and window title are rendered by this app, so a malicious app could fake them — that's a limitation of every embedded WebView, not just this one. TEMPOC can't use the usual answer (logging in via your system browser) because the session cookie must live inside the app's WebView for usage interception to work at all.

What you *can* rely on:

- **Verify it yourself with DevTools.** Press **F12** in the login window. DevTools is drawn by Chromium itself, not by this app, and shows the real URL, certificate, and network traffic. If you're skeptical, this is the check that actually proves something.
- **Audit the code.** This project is open source. Your credentials are typed into claude.ai's own page and sent over TLS directly to claude.ai — they never pass through this app's code. The injected script ([`inject.js`](inject.js)) is a few hundred lines; you can read exactly what it touches (the usage API responses, and nothing you type).
- **No password is at stake.** claude.ai login is passwordless (an emailed one-time code) or Google/Apple SSO. Nothing long-lived is ever typed into this window.
- **The session is the app's job anyway.** By design, TEMPOC holds your claude.ai session — that's the only way it can read your usage. So "is the login page real?" reduces to "do I trust this app?", which is answered by the two points above, not by any bar the app draws.

## Development

```bash
cd desktop
wails3 dev               # run in development mode
wails3 build             # production build (see build/)
wails3 generate bindings # required after changing Go services/types
```

For architecture details (the two-window design, the usage-interception mechanism, settings, known constraints), see [`CLAUDE.md`](CLAUDE.md).
