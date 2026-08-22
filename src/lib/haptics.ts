/**
 * iOS-style tactile feedback using the Web Vibration API.
 * Gracefully no-ops in environments without vibration support.
 */

export type HapticType =
  | "selection"
  | "light"
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error";

export function triggerHaptic(type: HapticType = "light"): void {
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
