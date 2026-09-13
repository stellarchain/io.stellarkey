/**
 * iOS-style tactile feedback using the Web Vibration API & Web Audio FX.
 * Gracefully no-ops in environments without hardware vibration or audio.
 *
 * Patterns follow their documented meanings: `selection` while a control's
 * value changes, impact (`light`/`medium`/`heavy`) for physical metaphors,
 * and notification (`success`/`warning`/`error`) for outcomes. Navigation,
 * opening and dismissing surfaces play nothing.
 */

import { playLockSound, playSuccessChime } from "./sounds";

export type HapticType =
  | "selection"
  | "light"
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error";

/** Two feedback sources for one event (a control and its handler, or a handler and a toast) collapse into one. */
const DUPLICATE_WINDOW_MS = 150;
let lastHaptic: { type: HapticType; at: number } | null = null;

export function triggerHaptic(type: HapticType = "light"): void {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (lastHaptic && lastHaptic.type === type && now - lastHaptic.at < DUPLICATE_WINDOW_MS) return;
  lastHaptic = { type, at: now };

  // Only outcomes carry a sound; taps and selections stay silent.
  if (type === "success") {
    playSuccessChime();
  } else if (type === "warning") {
    playLockSound();
  }

  if (typeof window === "undefined" || !("vibrate" in navigator)) return;

  try {
    switch (type) {
      case "selection":
        navigator.vibrate(10);
        break;
      case "light":
        navigator.vibrate(15);
        break;
      case "medium":
        navigator.vibrate(25);
        break;
      case "heavy":
        navigator.vibrate(40);
        break;
      case "success":
        navigator.vibrate([15, 60, 20]);
        break;
      case "warning":
        navigator.vibrate([25, 40, 25]);
        break;
      case "error":
        navigator.vibrate([40, 50, 40, 50, 50]);
        break;
    }
  } catch {
    // Ignore any browser security restrictions
  }
}
