package main

import "changeme/settings"

// SettingsService exposes settings.Repository to the frontend via Wails
// bindings. Kept in package main (alongside main.go) since this project has
// no _cmd/ subpackage split — see CLAUDE.md.
type SettingsService struct {
	repo *settings.Repository
}

// NewSettingsService constructs a SettingsService backed by repo.
func NewSettingsService(repo *settings.Repository) *SettingsService {
	return &SettingsService{repo: repo}
}

// Get loads the persisted settings (or defaults if none saved yet).
func (s *SettingsService) Get() (settings.Settings, error) {
	return s.repo.Load()
}

// Set persists settings.
func (s *SettingsService) Set(cfg settings.Settings) error {
	return s.repo.Save(cfg)
}
