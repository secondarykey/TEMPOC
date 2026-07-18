//go:build production

package main

import "log/slog"

// Release builds only surface warnings and errors; see loglevel_dev.go.
const logLevel = slog.LevelWarn
