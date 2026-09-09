/**
 * The Indian financial year runs 1 April to 31 March, and is identified here by
 * its starting year: 2026 means FY 2026-27, April 2026 to March 2027.
 */

/** The financial year that today falls in. */
export function currentFinancialYear(today: Date = new Date()): number {
  // getMonth() is zero based, so 3 is April.
  return today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
}

/** "FY 2026-27" for 2026. */
export function financialYearLabel(year: number): string {
  return `FY ${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

/** The assessment year that follows a financial year: "AY 2027-28" for 2026. */
export function assessmentYearLabel(year: number): string {
  return `AY ${year + 1}-${String((year + 2) % 100).padStart(2, '0')}`;
}

/** The current financial year and the ones before it, newest first. */
export function financialYearOptions(
  count = 6,
  today: Date = new Date(),
): { value: string; label: string }[] {
  const start = currentFinancialYear(today);
  return Array.from({ length: count }, (_unused, index) => start - index).map((year) => ({
    value: String(year),
    label: financialYearLabel(year),
  }));
}
