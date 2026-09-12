'use client';

import { useEffect } from 'react';
import {
  applyResolvedTheme,
  getStoredThemePreference,
  resolveTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from '@/lib/theme';

/** Keeps <html data-theme> correct after first paint: reapplies when the OS
 * theme changes while the preference is "system", when another tab changes the
 * preference, or when this tab changes it. The pre-paint script owns the very
 * first application, so this never causes a flash. */
export function ThemeController() {
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(getStoredThemePreference());
      applyResolvedTheme(resolved);
      // Match the browser/PWA chrome (status bar, address bar) to the theme.
      let meta = document.querySelector('meta[name="theme-color"]:not([media])');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', resolved === 'light' ? '#f2f2f7' : '#000000');
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onMedia = () => { if (getStoredThemePreference() === 'system') apply(); };
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === THEME_STORAGE_KEY) apply(); };
    media.addEventListener('change', onMedia);
    window.addEventListener(THEME_CHANGE_EVENT, apply);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onMedia);
      window.removeEventListener(THEME_CHANGE_EVENT, apply);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return null;
}
