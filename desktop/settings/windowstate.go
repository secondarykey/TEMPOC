package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// UnsetPos marks "no saved coordinate". 0 and negative values are legitimate
// positions on multi-monitor setups (a monitor left of or above the primary
// yields negative DIP coordinates), so absence needs an impossible sentinel
// rather than a zero check.
const UnsetPos = -9999

// WindowState persists native window geometry between launches. Kept separate
// from Settings (windowstate.json vs settings.json): it is written by the
// window system at quit rather than edited by the user, and keeping it out of
// Settings means the settings window's draft/Apply round trip can never
// clobber a position that was saved after the draft was loaded.
type WindowState struct {
	MainX int `json:"mainX"`
	MainY int `json:"mainY"`
	// MainW is the main window width. 0 means unset (a width can never
	// legitimately be zero, so no sentinel is needed). Height is not saved:
	// the frontend continuously sizes it to fit the bar content.
	MainW int `json:"mainW"`
}

// DefaultWindowState returns a state with no saved position.
func DefaultWindowState() WindowState {
	return WindowState{MainX: UnsetPos, MainY: UnsetPos}
}

// windowStatePath returns os.UserConfigDir()/TEMPOC/windowstate.json — the
// same directory settings.json lives in.
func windowStatePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "TEMPOC", "windowstate.json"), nil
}

// LoadWindowState reads windowstate.json. Missing or unreadable files yield
// the default (unset) state — a bad state file should never block startup.
func LoadWindowState() WindowState {
	st := DefaultWindowState()
	path, err := windowStatePath()
	if err != nil {
		return st
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return st
	}
	if err := json.Unmarshal(data, &st); err != nil {
		return DefaultWindowState()
	}
	return st
}

// SaveWindowState writes windowstate.json, creating the config directory if
// needed.
func SaveWindowState(st WindowState) error {
	path, err := windowStatePath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
