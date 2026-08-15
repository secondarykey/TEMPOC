//go:build !linux

package main

// enableCookiePersistence is a no-op everywhere but Linux: WebView2 (Windows)
// and WKWebView (macOS) already persist cookies in their own per-app data
// stores. See cookies_linux.go for why Linux needs the explicit call.
func enableCookiePersistence() {}
