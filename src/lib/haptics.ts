/**
 * iOS-style tactile feedback using the Web Vibration API & Web Audio FX.
 * Gracefully no-ops in environments without hardware vibration or audio.
 */

import { playLockSound, playSuccessChime, playTapSound } from "./sounds";

export type HapticType =
  | "selection"
  | "light"
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error";

export function triggerHaptic(type: HapticType = "light"): void {
  // Play subtle matching synthesized audio cue
  if (type === "success") {
    playSuccessChime();
  } else if (type === "selection" || type === "light") {
    playTapSound();
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
