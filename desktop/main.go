package main

import (
	"embed"
	"encoding/json"
	"log"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"changeme/settings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// appQuitting is set while the whole application is shutting down. The
// interceptor window's close hook consults it: normally it swallows a close
// (hiding the window instead of destroying it), but during shutdown it must let
// the real close through so the process can exit.
var appQuitting atomic.Bool

// Wails embeds the built frontend (frontend/dist) into the binary.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

// inject.js is registered as a document-created script on the Claude window. It
// monkeypatches window.fetch to intercept the usage API response and forwards
// the parsed values to Go via window.chrome.webview.postMessage.
//
//go:embed inject.js
var injectJS string

// version is the desktop app's version, and `version` the single source of
// truth for it. `go run ./_cmd/version.go <x.y.z>` writes that file and mirrors
// the value into build/config.yml and frontend/package.json; the exe metadata
// (ProductVersion etc.) comes from config.yml via `wails3 update build-assets`.
// The file must sit next to this main.go for go:embed to reach it.
//
//go:embed version
var version string

// UsagePayload carries the seven_day / five_hour objects from claude.ai's usage
// API through to the frontend. Kept loose (json.RawMessage) as the frontend
// reads utilization / resets_at directly.
type UsagePayload struct {
	SevenDay     json.RawMessage `json:"seven_day"`
	FiveHour     json.RawMessage `json:"five_hour"`
	WeeklyScoped json.RawMessage `json:"weekly_scoped,omitempty"`
}

// clampToWorkArea moves (x, y) so a w×h window stays inside a screen work
// area. Right/bottom are clamped before left/top so that the top-left corner
// wins (stays reachable) when the window is larger than the area.
func clampToWorkArea(x, y, w, h int, area application.Rect) (int, int) {
	if x+w > area.X+area.Width {
		x = area.X + area.Width - w
	}
	if y+h > area.Y+area.Height {
		y = area.Y + area.Height - h
	}
	if x < area.X {
		x = area.X
	}
	if y < area.Y {
		y = area.Y
	}
	return x, y
}

// placeOnMainScreen positions win on the same screen as mainWin — offset a
// little from the main window and clamped to that screen's work area — so
// secondary windows open on the monitor the user is actually working on
// instead of wherever the OS defaults to. Callers invoke this only before a
// window's first Show(); after that the user's own placement is respected
// across hide/show cycles. Must run after app.Run() (ScreenNearestDipPoint
// returns nil earlier), which holds for all event-handler callers.
func placeOnMainScreen(mainWin, win *application.WebviewWindow) {
	mx, my := mainWin.Position()
	mw, mh := mainWin.Size()
	ww, wh := win.Size()
	x, y := mx+48, my+48
	if screen := application.ScreenNearestDipPoint(application.Point{X: mx + mw/2, Y: my + mh/2}); screen != nil {
		x, y = clampToWorkArea(x, y, ww, wh, screen.WorkArea)
	}
	win.SetPosition(x, y)
}

// claudeBootstrapHTML is the initial document for the Claude window. Booting in
// HTML mode is what makes Wails register injectJS as a document-created script;
// the page then redirects itself to the real usage URL.
const claudeBootstrapHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loading Claude…</title></head><body style="margin:0;background:#06070f"><script>location.replace("https://claude.ai/new#settings/usage");</script></body></html>`

// usageMessage is the shape of the JSON string posted from inject.js via
// window.chrome.webview.postMessage.
type usageMessage struct {
	Type         string          `json:"type"`
	Msg          string          `json:"msg"`
	SevenDay     json.RawMessage `json:"seven_day"`
	FiveHour     json.RawMessage `json:"five_hour"`
	WeeklyScoped json.RawMessage `json:"weekly_scoped"`
}

// claudeCtl controls the visibility of the interception window. It is hidden by
// default, shown when the user clicks the frontend's "Log in to Claude" button
// (offered after an auth-required notification), auto-hidden once usage data
// starts flowing, and can be pinned open by the user for debugging.
type claudeCtl struct {
	win    *application.WebviewWindow
	mu     sync.Mutex
	pinned bool // user explicitly opened it for debugging
}

// showForAuth reveals the window so the user can log in (triggered by the
// frontend's login button). Deliberately does not pin: once the login succeeds
// and usage data flows, autoHide tucks the window away again.
func (c *claudeCtl) showForAuth() { c.win.Show() }

// autoHide tucks the window away once usage data is flowing, unless the user
// has pinned it open for debugging.
func (c *claudeCtl) autoHide() {
	c.mu.Lock()
	pinned := c.pinned
	c.mu.Unlock()
	if !pinned {
		c.win.Hide()
	}
}

// hideOnClose is the close-button handler. Destroying the interceptor window
// would permanently stop usage interception — inject.js is installed only at
// window-creation time and cannot be re-injected into a fresh window (see the
// ExecJS caveat below). So instead of letting the X destroy it, we hide it (and
// drop the debug pin); the user can bring it back via the settings toggle.
func (c *claudeCtl) hideOnClose() {
	c.mu.Lock()
	c.pinned = false
	c.mu.Unlock()
	c.win.Hide()
}

// toggle flips visibility on user request (the debug button). Showing pins it
// open so incoming usage data won't auto-hide it out from under the user.
func (c *claudeCtl) toggle() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.win.IsVisible() {
		c.win.Hide()
		c.pinned = false
	} else {
		c.win.Show()
		c.pinned = true
	}
}

func init() {
	// Register the usage event so the frontend gets a typed JS/TS API for it.
	application.RegisterEvent[UsagePayload]("tempoc:usage")
}

func main() {
	// The embedded file keeps its trailing newline.
	version = strings.TrimSpace(version)
	log.Printf("tempoc: starting v%s", version)

	// claude holds the interception window; wired up after the window exists.
	claude := &claudeCtl{}

	settingsRepo, err := settings.NewRepository()
	if err != nil {
		log.Fatal(err)
	}
	settingsSvc := NewSettingsService(settingsRepo)

	// Loaded once at startup to configure inject.js's auto-refresh interval.
	// Changing refreshInterval in the Settings UI takes effect on next app
	// launch: the interceptor script (inject.js) is only pushed into the
	// Claude window once, at window-creation time below, and cannot be
	// re-injected live (see the ExecJS caveat in the claude.win comment).
	cfg, err := settingsRepo.Load()
	if err != nil {
		log.Printf("tempoc: failed to load settings, using defaults: %v", err)
		cfg = settings.Default()
	}
	// Saved native window geometry (separate file from user settings — see
	// settings.WindowState). Restored in two phases: the coordinates go into
	// the window options here, and are clamped to the actual screens once the
	// window is up (WindowRuntimeReady below).
	winState := settings.LoadWindowState()

	refreshMs := cfg.RefreshInterval * 60000
	// ReplaceAll, not Replace(n=1): the placeholder must be substituted wherever
	// it appears — a single-occurrence replace once hit a mention of the token
	// in an inject.js comment instead of the code, leaving the real assignment
	// as an undefined identifier and silently killing auto-refresh.
	resolvedInjectJS := strings.ReplaceAll(injectJS, "__TEMPOC_REFRESH_MS__", strconv.Itoa(refreshMs))

	var app *application.App
	app = application.New(application.Options{
		Name:        "TEMPOC",
		Description: "Claude usage monitor",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Services: []application.Service{
			application.NewService(settingsSvc),
		},
		// RawMessageHandler receives every window.chrome.webview.postMessage
		// call whose payload does not start with "wails:" — including messages
		// posted from the claude.ai page by inject.js.
		RawMessageHandler: func(window application.Window, message string, originInfo *application.OriginInfo) {
			if originInfo == nil {
				return
			}

			var msg usageMessage
			if err := json.Unmarshal([]byte(message), &msg); err != nil {
				log.Printf("tempoc: failed to parse raw message: %v", err)
				return
			}

			// location is accepted from ANY origin (unlike everything else):
			// during OAuth the interceptor window legitimately sits on e.g.
			// accounts.google.com, and the title should say so rather than
			// keep the last claude.ai URL. Spoofing is prevented by requiring
			// the reported URL to start with the message's actual WebView2
			// origin — a page can only put its own URL in the title.
			if msg.Type == "location" {
				if msg.Msg != "" && strings.HasPrefix(msg.Msg, originInfo.Origin) {
					claude.win.SetTitle(msg.Msg + " — TEMPOC interceptor")
				}
				return
			}

			if !strings.Contains(originInfo.Origin, "claude.ai") {
				return
			}
			switch msg.Type {
			case "debug":
				log.Printf("tempoc[debug]: %s", msg.Msg)
			case "auth-required":
				// Claude redirected to its login page. Don't pop the window up
				// on our own — tell the frontend, which shows a "Log in to
				// Claude" button; clicking it emits tempoc:login (handled
				// below) to reveal the window.
				log.Printf("tempoc: login required, notifying frontend")
				app.Event.Emit("tempoc:auth-required", nil)
			case "usage":
				log.Printf("tempoc: received usage payload from %s", originInfo.Origin)
				app.Event.Emit("tempoc:usage", UsagePayload{
					SevenDay:     msg.SevenDay,
					FiveHour:     msg.FiveHour,
					WeeklyScoped: msg.WeeklyScoped,
				})
				// Data is flowing, so we're authenticated — hide the window
				// (unless the user pinned it open for debugging).
				claude.autoHide()
			}
		},
	})

	// Phase 1 of the main-window position restore. InitialPosition's zero
	// value is WindowCentered, which silently ignores X/Y — WindowXY must be
	// explicit for saved coordinates to apply. Coordinates that ended up
	// off-screen (monitor unplugged since last run) are corrected in phase 2
	// (WindowRuntimeReady below), where screen information is available.
	mainInitialPos := application.WindowCentered
	if winState.MainX != settings.UnsetPos || winState.MainY != settings.UnsetPos {
		mainInitialPos = application.WindowXY
	}

	// Restore the saved width (height always tracks content). Implausible
	// values — below the window's MinWidth or beyond any reasonable monitor —
	// fall back to the default rather than being clamped; a screen-aware check
	// in phase 2 does the same for widths wider than the actual work area.
	const defaultMainWidth = 520
	mainWidth := winState.MainW
	if mainWidth < 360 || mainWidth > 4000 {
		mainWidth = defaultMainWidth
	}

	// Main UI window: the TEMPOC usage bars (served from frontend/dist).
	// Frameless — the title bar and window controls are drawn in React.
	mainWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:           "TEMPOC",
		Frameless:       true,
		X:               winState.MainX,
		Y:               winState.MainY,
		InitialPosition: mainInitialPos,
		Width:           mainWidth,
		Height:          340,
		MinWidth:        360,
		// Low enough that the window can shrink to fit a single compact-mode usage
		// row; the frontend measures its content and sizes the window to match
		// (clamped to MIN_WINDOW_H in App.tsx, which mirrors this value).
		MinHeight: 90,
		// Restore the persisted always-on-top state natively at creation. The
		// frontend also applies it (for the runtime pin toggle), but its very
		// early startup call proved unreliable — the pin icon showed "on" while
		// the window wasn't actually topmost — so the native option is the
		// authoritative restore path.
		AlwaysOnTop: cfg.AlwaysOnTop,
		// Fully transparent window: the webview's clear areas are see-through to
		// whatever is behind the window. The on/off toggle is done in the
		// frontend by painting (or clearing) an opaque page background — the
		// native window stays transparent-capable at all times (see style.css
		// html.is-transparent and settings.transparent).
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(6, 7, 15, 0),
		URL:              "/",
	})

	// Second window: claude.ai's usage page, loaded hidden in the background
	// to intercept the usage API.
	//
	// injectJS is installed via WebView2's AddScriptToExecuteOnDocumentCreated,
	// which Wails only wires up (chromium.Init) when a window is created in HTML
	// mode. We therefore boot the window with a tiny HTML page that immediately
	// redirects to claude.ai. The registered script then runs at document-start
	// on EVERY subsequent document (persisting across cross-origin navigation and
	// SPA reloads), so window.fetch is monkeypatched before Claude's own scripts.
	//
	// (ExecJS after navigation does NOT work here: it is gated on
	// window.runtimeLoaded, which only becomes true when the @wailsio/runtime
	// handshake fires — that never happens on a third-party page like claude.ai,
	// so every ExecJS call would be queued forever and never execute.)
	//
	// Hidden by default: it only exists to intercept the usage API. When a
	// login is required it is shown via the frontend's "Log in to Claude"
	// button (tempoc:login), and it can be toggled for debugging.
	claude.win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:           "Claude (TEMPOC interceptor)",
		Width:           900,
		Height:          700,
		Hidden:          true,
		HTML:            claudeBootstrapHTML,
		JS:              resolvedInjectJS,
		DevToolsEnabled: true,
	})

	// Third window: the settings screen, split out of the main window so
	// editing settings doesn't resize/reflow the usage view behind it. Like
	// the interceptor window, it's a separate JS context — the frontend can't
	// share React state with the main window, so it edits a local draft and
	// only calls SettingsService.Set (and notifies the main window) when the
	// user clicks Apply. Hidden at startup (nobody needs it until the gear is
	// clicked) and unpinned from any specific usage-data state, unlike
	// claude.win's auto-show-on-auth-required behaviour.
	settingsWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "TEMPOC Settings",
		Frameless: true,
		Width:     520,
		Height:    800, // same fixed height the old in-window settings view used
		MinWidth:  420,
		MinHeight: 400,
		Hidden:    true,
		// Deliberately opaque (unlike mainWin's transparent background): the
		// transparency toggle only ever applies to the usage view, and an
		// unconditionally solid background avoids a white flash while the
		// webview paints its first frame.
		BackgroundColour: application.NewRGBA(6, 7, 15, 255),
		URL:              "/?window=settings",
	})

	// Phase 2 of the main-window position restore: once this window's runtime
	// is up (screen information is unavailable before app.Run(), and
	// ApplicationStarted doesn't guarantee this window's readiness), clamp the
	// saved position into the nearest screen's work area so a monitor removed
	// since the last run can't strand the window off-screen.
	mainWin.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		w, h := mainWin.Size()
		x, y := mainWin.Position()
		screen := application.ScreenNearestDipPoint(application.Point{X: x + w/2, Y: y + h/2})
		if screen == nil {
			return
		}
		// A restored width wider than the actual work area falls back to the
		// default (same policy as the pre-Run sanity check above) instead of
		// being clamped to the edge.
		if w > screen.WorkArea.Width {
			w = defaultMainWidth
			mainWin.SetSize(w, h)
		}
		if winState.MainX == settings.UnsetPos && winState.MainY == settings.UnsetPos {
			return
		}
		if cx, cy := clampToWorkArea(winState.MainX, winState.MainY, w, h, screen.WorkArea); cx != winState.MainX || cy != winState.MainY {
			mainWin.SetPosition(cx, cy)
		}
	})

	// Save the main window position and width exactly once per run, for
	// restore on next launch. A minimized window reports around -32000; don't
	// persist that.
	var savePosOnce sync.Once
	saveMainPos := func() {
		x, y := mainWin.Position()
		if x <= -30000 || y <= -30000 {
			return
		}
		w, _ := mainWin.Size()
		if err := settings.SaveWindowState(settings.WindowState{MainX: x, MainY: y, MainW: w}); err != nil {
			log.Printf("tempoc: failed to save window state: %v", err)
		}
	}

	// Quit from the titlebar ✕: the frontend emits this instead of calling
	// Window.Close() so the position can be captured while the window is still
	// fully alive — during WindowClosing a frameless window may already report
	// bogus coordinates.
	app.Event.On("tempoc:quit", func(*application.CustomEvent) {
		savePosOnce.Do(saveMainPos)
		appQuitting.Store(true)
		app.Quit()
	})

	// Closing the main window quits the whole app. Without this, the hidden
	// interceptor window would remain the only registered window, so the process
	// would keep running with no visible UI and never post its quit message.
	// Setting appQuitting first lets the interceptor's close hook (below) allow
	// its real close during the ensuing shutdown.
	// The position save here is best effort, for close paths that bypass
	// tempoc:quit (Alt+F4, OS shutdown) — see the frameless caveat above.
	mainWin.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		savePosOnce.Do(saveMainPos)
		appQuitting.Store(true)
		app.Quit()
	})

	// Intercept the interceptor window's close: hide it instead of destroying
	// it, so usage interception keeps working (unless the app is shutting down).
	// Registered as a hook (hooks run before listeners) so cancelling here
	// pre-empts Wails' default listener that would otherwise destroy the window.
	claude.win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if appQuitting.Load() {
			return
		}
		e.Cancel()
		claude.hideOnClose()
	})

	// Same hide-on-close treatment for the settings window: it has no
	// re-injection constraint like claude.win, but destroying it would still
	// tear down its React state (the in-progress draft) for no benefit —
	// hiding keeps a Show() cheap and lets the eventual reload-on-open handler
	// (tempoc:open-settings, front end) reset the draft instead.
	settingsWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if appQuitting.Load() {
			return
		}
		e.Cancel()
		settingsWin.Hide()
	})

	// Login request: the main UI's "Log in to Claude" button emits this after
	// an auth-required notification. Show the interceptor window (unpinned, so
	// the usual autoHide tucks it away again once the login completes and
	// usage data starts flowing). If the session died without a navigation
	// (external logout — auth-required came from a 401, not from landing on
	// /login), the window may still render a stale SPA page; reload it to the
	// usage URL so claude.ai bounces to its login page. The document-created
	// script survives the navigation, so interception keeps working.
	// Secondary windows open on the main window's monitor the first time they
	// are shown; afterwards the user's own placement survives hide/show.
	var placeClaudeOnce, placeSettingsOnce sync.Once

	app.Event.On("tempoc:login", func(*application.CustomEvent) {
		placeClaudeOnce.Do(func() { placeOnMainScreen(mainWin, claude.win) })
		claude.showForAuth()
		claude.win.ExecJS(`if (!/^\/login\b/.test(location.pathname)) { location.replace("https://claude.ai/new#settings/usage"); }`)
	})

	// Manual refresh: the main UI's refresh button emits this. Drive the
	// interceptor page to click claude.ai's own usage refresh button, which
	// re-requests the usage API; our patched fetch intercepts the fresh
	// response and pushes it back to the UI. Relies on inject.js having enabled
	// ExecJS via the faked wails:runtime:ready handshake.
	app.Event.On("tempoc:refresh", func(*application.CustomEvent) {
		claude.win.ExecJS("window.__tempocClickRefresh && window.__tempocClickRefresh();")
	})

	// Debug toggle: the main UI emits this to show/hide the Claude window.
	app.Event.On("tempoc:toggle-claude", func(*application.CustomEvent) {
		if !claude.win.IsVisible() {
			placeClaudeOnce.Do(func() { placeOnMainScreen(mainWin, claude.win) })
		}
		claude.toggle()
	})

	// Open the settings window: the main UI's gear button emits this.
	// SetAlwaysOnTop is re-applied here (rather than relying on whatever it
	// was set to at window creation) so the settings window keeps up with the
	// main window's pin state — otherwise, if the user pins the main window
	// after startup, the settings window would still be a normal window and
	// could end up hidden behind the now-topmost main window.
	app.Event.On("tempoc:open-settings", func(*application.CustomEvent) {
		if cfgNow, err := settingsRepo.Load(); err == nil {
			settingsWin.SetAlwaysOnTop(cfgNow.AlwaysOnTop)
		}
		placeSettingsOnce.Do(func() { placeOnMainScreen(mainWin, settingsWin) })
		settingsWin.Show()
	})

	// Run the application. This blocks until the application has been exited.
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
