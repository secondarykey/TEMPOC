// TEMPOC theme colours, resolved through CSS variables so they follow the
// active theme (style.css :root = dark, [data-theme="light"] overrides).
// var() works everywhere these are used: inline style color/background and
// the DualRange linear-gradient string.
export const COLORS = {
  accent: 'var(--color-accent)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
};

// Applies the theme setting ("system" | "light" | "dark") by stamping a
// data-theme attribute on <html>. "system" (and "" from an older
// settings.json / a not-yet-loaded Settings) resolves via
// prefers-color-scheme and keeps tracking OS theme changes until a fixed
// theme is applied. Each window is its own JS context, so both the main and
// the settings window call this for themselves.
let media: MediaQueryList | null = null;
let onSystemChange: ((e: MediaQueryListEvent) => void) | null = null;

export function applyTheme(theme: string) {
  if (media && onSystemChange) {
    media.removeEventListener('change', onSystemChange);
    media = null;
    onSystemChange = null;
  }
  const set = (mode: 'light' | 'dark') => document.documentElement.setAttribute('data-theme', mode);
  if (theme === 'light' || theme === 'dark') {
    set(theme);
    return;
  }
  media = window.matchMedia('(prefers-color-scheme: dark)');
  onSystemChange = (e) => set(e.matches ? 'dark' : 'light');
  media.addEventListener('change', onSystemChange);
  set(media.matches ? 'dark' : 'light');
}
