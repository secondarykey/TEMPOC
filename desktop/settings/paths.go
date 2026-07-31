package settings

import (
	"os"
	"path/filepath"
)

// ConfigDir returns os.UserConfigDir()/TEMPOC — the one directory holding every
// file the app persists (settings.json, windowstate.json, and on Linux the
// WebKit cookie store). It does not create the directory; writers call
// os.MkdirAll themselves.
func ConfigDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "TEMPOC"), nil
}
