/** Prevent user-controlled strings from becoming spreadsheet formulas. */
export function neutralizeSpreadsheetFormula(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function csvField(value: string | number | null): string {
  const text = neutralizeSpreadsheetFormula(value);
  return `"${text.replaceAll('"', '""')}"`;
}
