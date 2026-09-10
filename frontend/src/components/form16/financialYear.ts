/**
 * The Indian financial year runs 1 April to 31 March, and is identified here by
 * its starting year: 2026 means FY 2026-27, April 2026 to March 2027.
 */

/**
 * The calendar date in India, whatever zone the reader's browser is in.
 *
 * `Date#getMonth` reads the browser's local zone. At 20:00 UTC on 31 March,
 * India has already begun the new financial year while a browser in New York
 * has not, and the page would default to the year that closed the night
 * before. The financial year is a fact about India, so it is read in India.
 */
const istParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: 'numeric',
});

/** The financial year that today falls in, by Indian time. */
export function currentFinancialYear(today: Date = new Date()): number {
  const parts = istParts.formatToParts(today);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  // Months here are one based, so 4 is April.
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    // Should not happen, but guessing a year on a payroll page is worse than
    // falling back to the browser's own reading of the same instant.
    return today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  }
  return month >= 4 ? year : year - 1;
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
