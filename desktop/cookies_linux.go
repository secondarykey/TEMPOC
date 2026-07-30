package main

// Cookie persistence for the WebKitGTK webview.
//
// Wails' Linux backend takes the default network session
// (webkit_network_session_get_default() in linux_cgo.go) but never calls
// webkit_cookie_manager_set_persistent_storage() on it, and WebKitGTK keeps
// cookies in memory only until a storage file is named. The interceptor window
// therefore lost the claude.ai session on every restart, forcing a fresh login
// — where Windows keeps it in the WebView2 user data folder
// (%APPDATA%\tempoc\EBWebView) with no work from us. There is no Wails option
// or environment variable for this (LinuxOptions only exposes
// DisableQuitOnLastWindowClosed and ProgramName), so we reach for the same
// default session ourselves: it is a process-wide singleton, and every window
// Wails creates uses it (create_webview_with_user_content_manager passes no
// network-session property, so the webview picks up the default).

/*
#cgo pkg-config: webkitgtk-6.0
#include <stdlib.h>
#include <webkit/webkit.h>

static void tempoc_set_cookie_storage(const char *path) {
    WebKitNetworkSession *session = webkit_network_session_get_default();
    if (session == NULL) {
        return;
    }
    WebKitCookieManager *manager = webkit_network_session_get_cookie_manager(session);
    if (manager == NULL) {
        return;
    }
    // Loads any cookies already in the file and writes later changes back to
    // it. The acceptance policy is left at WebKitGTK's default
    // (no third-party cookies) — claude.ai and the OAuth providers are all
    // first-party during a top-level navigation.
    webkit_cookie_manager_set_persistent_storage(manager, path, WEBKIT_COOKIE_PERSISTENT_STORAGE_SQLITE);
}
*/
import "C"

import (
	"log/slog"
	"os"
	"path/filepath"
	"unsafe"

	"changeme/settings"
)

// enableCookiePersistence points the WebKit cookie manager at
// <config dir>/TEMPOC/cookies.sqlite so the claude.ai login survives a restart.
//
// Call it from main() before app.Run(): Wails only creates the native webviews
// once the GTK loop is running, and the storage has to be attached before the
// interceptor window's first request — a session attached later would start
// empty, sending the user to /login even though a valid cookie sits on disk.
// Running this early also keeps it on the main thread (Wails locks the Go main
// goroutine to it in init), which is where WebKit wants to be called from. It
// touches no GTK widget, so gtk_init not having run yet is fine.
//
// Failures are logged and swallowed: without persistence the app still works,
// it just asks for a login again next time — not a reason to refuse to start.
func enableCookiePersistence() {
	dir, err := settings.ConfigDir()
	if err != nil {
		slog.Warn("cannot resolve config dir, cookies will not persist", "err", err)
		return
	}
	// WebKit does not create the parent directory of the storage file, and on a
	// first run nothing else has written to the config dir yet. 0700 rather
	// than the 0755 used for the JSON files: this one holds session cookies.
	if err := os.MkdirAll(dir, 0700); err != nil {
		slog.Warn("cannot create config dir, cookies will not persist", "err", err)
		return
	}

	path := filepath.Join(dir, "cookies.sqlite")
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	C.tempoc_set_cookie_storage(cPath)

	slog.Info("cookie persistence enabled", "path", path)
}
