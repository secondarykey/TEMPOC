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

// UsagePayload carries the seven_day / five_hour objects from claude.ai's usage
// API through to the frontend. Kept loose (json.RawMessage) as the frontend
// reads utilization / resets_at directly.
type UsagePayload struct {
	SevenDay     json.RawMessage `json:"seven_day"`
	FiveHour     json.RawMessage `json:"five_hour"`
	WeeklyScoped json.RawMessage `json:"weekly_scoped,omitempty"`
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
// default, auto-shown when Claude needs a login, auto-hidden once usage data
// starts flowing, and can be pinned open by the user for debugging.
type claudeCtl struct {
	win    *application.WebviewWindow
	mu     sync.Mutex
	pinned bool // user explicitly opened it for debugging
}

// showForAuth reveals the window because the user needs to log in.
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
	refreshMs := cfg.RefreshInterval * 60000
	resolvedInjectJS := strings.Replace(injectJS, "__TEMPOC_REFRESH_MS__", strconv.Itoa(refreshMs), 1)

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
			if originInfo == nil || !strings.Contains(originInfo.Origin, "claude.ai") {
				return
			}

			var msg usageMessage
			if err := json.Unmarshal([]byte(message), &msg); err != nil {
				log.Printf("tempoc: failed to parse raw message: %v", err)
				return
			}
			switch msg.Type {
			case "debug":
				log.Printf("tempoc[debug]: %s", msg.Msg)
			case "auth-required":
				// Claude redirected to its login page — surface the window so
				// the user can sign in.
				log.Printf("tempoc: login required, showing Claude window")
				claude.showForAuth()
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

	// Main UI window: the TEMPOC usage bars (served from frontend/dist).
	// Frameless — the title bar and window controls are drawn in React.
	mainWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "TEMPOC",
		Frameless: true,
		Width:     520,
		Height:    340,
		MinWidth:  360,
		// Low enough that the window can shrink to fit a single compact-mode usage
		// row; the frontend measures its content and sizes the window to match
		// (clamped to MIN_WINDOW_H in App.tsx, which mirrors this value).
		MinHeight: 90,
		// Fully transparent window: the webview's clear areas are see-through to
		// whatever is behind the window. The on/off toggle is done in the
		// frontend by painting (or clearing) an opaque page background — the
		// native window stays transparent-capable at all times (see style.css
		// html.is-transparent and settings.transparent).
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(6, 7, 15, 0),
		URL:              "/",
	})

	// Second window: claude.ai's usage page, kept visible so the user can log
	// in manually.
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
	// Hidden by default: it only exists to intercept the usage API. It is shown
	// automatically when a login is required, and can be toggled for debugging.
	claude.win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:           "Claude (TEMPOC interceptor)",
		Width:           900,
		Height:          700,
		Hidden:          true,
		HTML:            claudeBootstrapHTML,
		JS:              resolvedInjectJS,
		DevToolsEnabled: true,
	})

	// Closing the main window quits the whole app. Without this, the hidden
	// interceptor window would remain the only registered window, so the process
	// would keep running with no visible UI and never post its quit message.
	// Setting appQuitting first lets the interceptor's close hook (below) allow
	// its real close during the ensuing shutdown.
	mainWin.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
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
		claude.toggle()
	})

	// Run the application. This blocks until the application has been exited.
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
