/** Appearance preference: follow the OS, or force a mode. Persisted locally and
 * applied to <html data-theme> so the CSS variable palette flips. The wallet is
 * client-rendered, so a small pre-paint script (see the root layout) applies the
 * resolved theme before first paint to avoid a flash. */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'stellarkey.theme';
export const THEME_CHANGE_EVENT = 'stellarkey:theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Runs before paint. Kept as a string so it can be inlined verbatim in <body>. */
export const THEME_INIT_SCRIPT =
  "(function(){try{var p=localStorage.getItem('" + THEME_STORAGE_KEY + "');" +
  "var t=(p==='light'||p==='dark')?p:((window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark');" +
  "document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();";

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

/** Persist the preference, apply it immediately, and notify listeners in this tab. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // A blocked storage still themes this session; it just will not persist.
  }
  applyResolvedTheme(resolveTheme(preference));
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
}
