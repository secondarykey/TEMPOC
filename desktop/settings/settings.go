// Package settings defines the TEMPOC configuration model shared between the
// Go backend and the frontend. It has no dependency on Wails so it can be
// unit tested and reused independently of the desktop application shell.
package settings

// Settings mirrors the configuration options exposed by the original TEMPOC
// Chrome extension (see src/options.js / src/content.js in the extension
// source), ported 1:1 so the desktop app supports the same knobs.
type Settings struct {
	ShowDay7           bool   `json:"showDay7"`
	ShowHour5          bool   `json:"showHour5"`
	Day7Danger         int    `json:"day7Danger"`
	Day7Warning        int    `json:"day7Warning"`
	Day7ColorEnabled   bool   `json:"day7ColorEnabled"`
	Hour5Danger        int    `json:"hour5Danger"`
	Hour5Warning       int    `json:"hour5Warning"`
	Hour5ColorEnabled  bool   `json:"hour5ColorEnabled"`
	ShowRemainDay7     bool   `json:"showRemainDay7"`
	ShowRemainHour5    bool   `json:"showRemainHour5"`
	// weekly_scoped is an additional window that may or may not exist in the
	// API response. Its bar/settings only take effect when the data is present.
	ShowWeeklyScoped         bool   `json:"showWeeklyScoped"`
	WeeklyScopedDanger       int    `json:"weeklyScopedDanger"`
	WeeklyScopedWarning      int    `json:"weeklyScopedWarning"`
	WeeklyScopedColorEnabled bool   `json:"weeklyScopedColorEnabled"`
	ShowRemainWeeklyScoped   bool   `json:"showRemainWeeklyScoped"`
	WeeklyScopedLabel        string `json:"weeklyScopedLabel"`
	DecimalPlaces      int    `json:"decimalPlaces"`
	DurationStyle      string `json:"durationStyle"`
	PercentFormat      string `json:"percentFormat"`
	RefreshInterval    int    `json:"refreshInterval"`
	UtilizationWarning int    `json:"utilizationWarning"`
	UtilizationDanger  int    `json:"utilizationDanger"`
	// Locale overrides the BCP-47 locale used to format the reset date/time and
	// remaining duration. Empty means "auto" (follow navigator.language).
	Locale string `json:"locale"`
	// Transparent makes the window background fully see-through (default off).
	Transparent bool `json:"transparent"`
	// AlwaysOnTop keeps the main window above other windows (default off). The
	// title-bar pin toggles it; persisting it here restores the state on restart.
	AlwaysOnTop bool `json:"alwaysOnTop"`
	// SizeMode is a desktop-only display density: "normal" | "small" | "compact".
	// It scales bar/text/padding sizing and, in "compact", collapses each usage
	// window to a single line. Selected via the General section select.
	SizeMode string `json:"sizeMode"`
}

// Default returns the same default values as the Chrome extension
// (src/options.js `defaults` / src/content.js module-level vars), except
// RefreshInterval: the extension rides the visible usage page's own polling,
// but the desktop interceptor window is hidden, so claude.ai stops polling on
// its own and the app must re-fetch itself — auto-refresh defaults to on.
func Default() Settings {
	return Settings{
		ShowDay7:           true,
		ShowHour5:          true,
		Day7Danger:         10,
		Day7Warning:        0,
		Day7ColorEnabled:   true,
		Hour5Danger:        10,
		Hour5Warning:       0,
		Hour5ColorEnabled:  true,
		ShowRemainDay7:     true,
		ShowRemainHour5:    false,

		ShowWeeklyScoped:         true,
		WeeklyScopedDanger:       10,
		WeeklyScopedWarning:      0,
		WeeklyScopedColorEnabled: true,
		ShowRemainWeeklyScoped:   true,
		WeeklyScopedLabel:        "Weekly (scoped)",
		DecimalPlaces:      2,
		DurationStyle:      "short",
		PercentFormat:      "{}%",
		RefreshInterval:    5,
		UtilizationWarning: 98,
		UtilizationDanger:  100,
		SizeMode:           "normal",
	}
}
