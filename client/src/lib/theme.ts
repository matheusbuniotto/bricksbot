export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'bricksbot-theme';

export function readStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'dark' || value === 'light') return value;
  } catch {
    /* ignore */
  }
  return 'light';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function toggleTheme(current: Theme): Theme {
  const next: Theme = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  return next;
}
