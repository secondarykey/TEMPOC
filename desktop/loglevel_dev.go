//go:build !production

package main

import "log/slog"

// logLevel is switched on the same `production` build tag Wails keys its own
// isDebugMode on: `wails3 dev` and plain `go build` compile without the tag
// and log at Info; release builds (`wails3 task windows:build`) get Warn from
// loglevel_production.go.
const logLevel = slog.LevelInfo
