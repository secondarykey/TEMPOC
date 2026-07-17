package settings

import (
	"bytes"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

// Repository persists Settings as JSON under the OS user config directory,
// e.g. %APPDATA%\TEMPOC\settings.json on Windows.
type Repository struct {
	path string
}

// NewRepository builds a Repository rooted at
// os.UserConfigDir()/TEMPOC/settings.json. It does not touch the filesystem
// until Load/Save is called.
func NewRepository() (*Repository, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	configDir := filepath.Join(dir, "TEMPOC")
	return &Repository{path: filepath.Join(configDir, "settings.json")}, nil
}

// Load reads settings.json, returning Default() if the file does not exist
// or does not parse. It starts from Default() and unmarshals the file over it
// so that any fields missing from an older settings.json keep sensible
// defaults. Only I/O errors (an existing file that cannot be read) are
// returned; a corrupt file is not an error, because callers up to the
// frontend treat Load errors as fatal and a hand-edited settings.json must
// never leave the app blank.
func (r *Repository) Load() (Settings, error) {
	s := Default()

	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	// Editors like Notepad may save the file with a UTF-8 BOM, which
	// encoding/json rejects; strip it so such a file still parses.
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	if err := json.Unmarshal(data, &s); err != nil {
		log.Printf("tempoc: settings.json is invalid, using defaults: %v", err)
		return Default(), nil
	}
	return s, nil
}

// Save writes settings.json, creating the config directory if needed.
func (r *Repository) Save(s Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(r.path), 0755); err != nil {
		return err
	}
	return os.WriteFile(r.path, data, 0644)
}
