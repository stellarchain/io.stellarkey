export type HorizontalTabKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/**
 * Returns the next horizontal tab index for the WAI-ARIA tabs keyboard model.
 * Unrelated keys return null so callers can leave native browser behavior alone.
 */
export function tabIndexAfterKey(
  currentIndex: number,
  tabCount: number,
  key: string,
): number | null {
  if (tabCount <= 0) return null;
  const current = Math.min(Math.max(currentIndex, 0), tabCount - 1);
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowRight") return (current + 1) % tabCount;
  if (key === "ArrowLeft") return (current - 1 + tabCount) % tabCount;
  return null;
}
