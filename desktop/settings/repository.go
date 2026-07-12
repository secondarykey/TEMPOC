package settings

import (
	"encoding/json"
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

// Load reads settings.json, returning Default() if the file does not exist.
// It starts from Default() and unmarshals the file over it so that any
// fields missing from an older settings.json keep sensible defaults.
func (r *Repository) Load() (Settings, error) {
	s := Default()

	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return Default(), err
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
