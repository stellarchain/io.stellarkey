/** Appearance preference: follow the OS, or force a mode. Persisted locally and
 * applied to <html data-theme> so the CSS variable palette flips. The wallet is
 * client-rendered, so a small pre-paint script (see the root layout) applies the
 * resolved theme before first paint to avoid a flash. */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'stellarkey.theme';
export const THEME_CHANGE_EVENT = 'stellarkey:theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

// A failed persistence write must not undo this tab's explicit choice. The
// preference also survives controller/settings remounts without becoming SSR
// state shared between requests or leaking across isolated browser contexts.
const sessionPreferences = new WeakMap<Window, ThemePreference>();

function parsePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME_PREFERENCE;
}

/** Runs before paint. Kept as a string so it can be inlined verbatim in <body>. */
export const THEME_INIT_SCRIPT =
  "(function(){var p;try{p=localStorage.getItem('" + THEME_STORAGE_KEY + "');}catch(e){}" +
  "var t=p==='light'?'light':(p==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');" +
  "document.documentElement.dataset.theme=t;})();";

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT_THEME_PREFERENCE;
  const current = sessionPreferences.get(window);
  if (current !== undefined) return current;
  let preference: ThemePreference = DEFAULT_THEME_PREFERENCE;
  try {
    preference = parsePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Keep the default when storage is unavailable; explicit session choices
    // still work through sessionPreferences.
  }
  sessionPreferences.set(window, preference);
  return preference;
}

/** One snapshot for the controller and every mounted appearance control. */
export function subscribeThemePreference(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const target = window;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    let preference = parsePreference(event.newValue);
    try {
      if (event.storageArea && event.storageArea !== target.localStorage) return;
      // A queued event may predate a newer local write. Read the current value
      // when possible; the event still supplies a fallback if reads are blocked.
      preference = parsePreference(target.localStorage.getItem(THEME_STORAGE_KEY));
    } catch { /* Preserve the event's non-sensitive preference. */ }
    sessionPreferences.set(target, preference);
    onChange();
  };
  target.addEventListener(THEME_CHANGE_EVENT, onChange);
  target.addEventListener('storage', onStorage);
  return () => {
    target.removeEventListener(THEME_CHANGE_EVENT, onChange);
    target.removeEventListener('storage', onStorage);
  };
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
  if (typeof window === 'undefined') return;
  sessionPreferences.set(window, preference);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // A blocked storage still themes this session; it just will not persist.
  }
  applyResolvedTheme(resolveTheme(preference));
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
}
