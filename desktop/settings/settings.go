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
}

// Default returns the same default values as the Chrome extension
// (src/options.js `defaults` / src/content.js module-level vars).
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
		DecimalPlaces:      2,
		DurationStyle:      "short",
		PercentFormat:      "{}%",
		RefreshInterval:    0,
		UtilizationWarning: 98,
		UtilizationDanger:  100,
	}
}
