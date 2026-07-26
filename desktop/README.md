# TEMPOC Desktop

A standalone desktop app (Wails v3) that shows elapsed-time progress bars for Claude's 5-hour and 7-day usage windows — including exactly when each window resets, which claude.ai itself doesn't display. It runs on Windows (WebView2), macOS (WKWebView) and Linux (WebKitGTK).

It works by loading claude.ai inside a hidden WebView, intercepting the usage API responses, and rendering the bars in its own compact, frameless window. All of the [Chrome extension](../chrome-extension/README.md)'s settings are available, plus desktop-only options (UI language — English / 日本語, following Claude's official locale codes; always-on-top; transparent window; size modes).

If you have **Usage credits** enabled on claude.ai, an extra bar can show how much of your monthly spend limit is used — it reads `$13.63/50.00 | 27%`, amounts and percentage together. It is **off by default**; turn it on under Settings → Usage credits (the section is only active once a spend limit is reported). Credits reset at the start of the UTC month, shown — like every other reset time here — in your own timezone.

Since credits are only spent once a plan limit runs out, that section also offers **Show only when needed**, which keeps the bar hidden until your 5-hour or 7-day usage actually reaches 100%.

For what the bars mean, and for privacy and disclaimer, see the [project README](../README.md).

## Installing

Download the archive for your OS from the [Releases page](https://github.com/secondarykey/TEMPOC/releases) (tagged `desktop-v*`). There is no installer. On first launch you will be asked to log in to claude.ai (see below).

- **Windows** (`…-windows-amd64.zip`) — unzip and run `tempoc.exe`. The WebView2 runtime it needs ships with Windows 10/11.
- **macOS** (`…-darwin-arm64.zip`, Apple Silicon) — unzip and open `tempoc.app`. It is ad-hoc signed, so the first time you may need to right-click → **Open** (or allow it under System Settings → Privacy & Security).
- **Linux** (`…-linux-amd64.tar.gz`) — extract and run `./tempoc`. The binary is dynamically linked, so **the GTK4 + WebKitGTK 6.0 runtime must be installed** (see below).

### Linux runtime requirements

The Linux build does **not** bundle its libraries; install them from your distro:

| Distro family | Install |
|---|---|
| Ubuntu 24.04+ / Debian 13+ | `sudo apt install libgtk-4-1 libwebkitgtk-6.0-4` |
| Fedora / RHEL / AlmaLinux | `sudo dnf install gtk4 webkitgtk6.0` |
| Arch | `sudo pacman -S gtk4 webkitgtk-6.0` |

The authoritative dependency list lives in [`build/linux/nfpm/nfpm.yaml`](build/linux/nfpm/nfpm.yaml) (used for future `.deb`/`.rpm` packaging); `ldd ./tempoc` shows the exact shared objects. Two environment-specific gotchas:

- **Ubuntu 24.04+ crashes on launch** (`bwrap: setting up uid map: Permission denied`) because it restricts unprivileged user namespaces, which WebKitGTK's sandbox needs. Enable them: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (persist via `/etc/sysctl.d/`).
- **Blank window on older GPUs** — set `GSK_RENDERER=gl` (e.g. `GSK_RENDERER=gl ./tempoc`). See [`multios.md`](multios.md) for details on both.

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
