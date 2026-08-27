export interface StandaloneEnvironment {
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
}

export interface DeviceEnvironment {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export type InstallHandoffAction = "hidden" | "backup-first" | "ios-guide" | "native-prompt";

export interface InstallHandoff {
  available: boolean;
  action: InstallHandoffAction;
}

export function isStandaloneDisplay(environment: StandaloneEnvironment): boolean {
  return environment.displayModeStandalone === true || environment.navigatorStandalone === true;
}

export function isIosDevice(environment: DeviceEnvironment): boolean {
  const userAgent = environment.userAgent ?? "";
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  return environment.platform === "MacIntel" && (environment.maxTouchPoints ?? 0) > 1;
}

export function readStandaloneDisplay(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return isStandaloneDisplay({
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
  });
}

export function readIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIosDevice({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

export function getInstallHandoff({
  standalone,
  ios,
  nativePromptAvailable,
  backupExported,
}: {
  standalone: boolean;
  ios: boolean;
  nativePromptAvailable: boolean;
  backupExported: boolean;
}): InstallHandoff {
  if (standalone || (!ios && !nativePromptAvailable)) {
    return { available: false, action: "hidden" };
  }
  if (!backupExported) return { available: true, action: "backup-first" };
  if (nativePromptAvailable) return { available: true, action: "native-prompt" };
  return { available: true, action: "ios-guide" };
}

export function shouldPrioritizeStandaloneRestore({
  standalone,
  walletExists,
}: {
  standalone: boolean;
  walletExists: boolean;
}): boolean {
  return standalone && !walletExists;
}
