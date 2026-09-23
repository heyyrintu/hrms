import { classifyWorkedDay } from './day-classification';

describe('classifyWorkedDay', () => {
  const thresholds = { minHalfDayMinutes: 240, minFullDayMinutes: 480 };

  it('keeps a full day PRESENT at and above the full-day threshold', () => {
    expect(classifyWorkedDay(480, 'PRESENT', thresholds)).toBe('PRESENT');
    expect(classifyWorkedDay(600, 'PRESENT', thresholds)).toBe('PRESENT');
  });

  it('keeps a full work-from-home day as WFH', () => {
    expect(classifyWorkedDay(480, 'WFH', thresholds)).toBe('WFH');
  });

  it('makes a day between the two thresholds a HALF_DAY, boundary included', () => {
    expect(classifyWorkedDay(240, 'PRESENT', thresholds)).toBe('HALF_DAY');
    expect(classifyWorkedDay(479, 'PRESENT', thresholds)).toBe('HALF_DAY');
    expect(classifyWorkedDay(300, 'WFH', thresholds)).toBe('HALF_DAY');
  });

  it('makes a day short of the half-day threshold ABSENT', () => {
    expect(classifyWorkedDay(239, 'PRESENT', thresholds)).toBe('ABSENT');
    expect(classifyWorkedDay(0, 'PRESENT', thresholds)).toBe('ABSENT');
  });

  it('treats a missing current status like PRESENT', () => {
    expect(classifyWorkedDay(480, null, thresholds)).toBe('PRESENT');
    expect(classifyWorkedDay(300, undefined, thresholds)).toBe('HALF_DAY');
  });

  it('re-evaluates a day an earlier, shorter session had already downgraded', () => {
    // Second clock-out of the day: the cumulative total now earns a full day.
    expect(classifyWorkedDay(500, 'HALF_DAY', thresholds)).toBe('PRESENT');
    expect(classifyWorkedDay(500, 'ABSENT', thresholds)).toBe('PRESENT');
    expect(classifyWorkedDay(250, 'ABSENT', thresholds)).toBe('HALF_DAY');
  });

  it('never touches a day that leave or a holiday already explains', () => {
    expect(classifyWorkedDay(0, 'LEAVE', thresholds)).toBeNull();
    expect(classifyWorkedDay(0, 'HOLIDAY', thresholds)).toBeNull();
  });

  it('does nothing when both thresholds are switched off', () => {
    expect(
      classifyWorkedDay(10, 'PRESENT', { minHalfDayMinutes: 0, minFullDayMinutes: 0 }),
    ).toBeNull();
    expect(
      classifyWorkedDay(10, 'PRESENT', { minHalfDayMinutes: null, minFullDayMinutes: null }),
    ).toBeNull();
  });

  it('never marks ABSENT for short hours when only the full-day rule is on', () => {
    const fullOnly = { minHalfDayMinutes: 0, minFullDayMinutes: 480 };
    expect(classifyWorkedDay(10, 'PRESENT', fullOnly)).toBe('HALF_DAY');
    expect(classifyWorkedDay(480, 'PRESENT', fullOnly)).toBe('PRESENT');
  });

  it('never marks HALF_DAY for short hours when only the half-day rule is on', () => {
    const halfOnly = { minHalfDayMinutes: 240, minFullDayMinutes: null };
    expect(classifyWorkedDay(240, 'PRESENT', halfOnly)).toBe('PRESENT');
    expect(classifyWorkedDay(239, 'PRESENT', halfOnly)).toBe('ABSENT');
  });

  it('treats a nonsense worked-minutes value as no work at all', () => {
    expect(classifyWorkedDay(Number.NaN, 'PRESENT', thresholds)).toBe('ABSENT');
    expect(classifyWorkedDay(-30, 'PRESENT', thresholds)).toBe('ABSENT');
  });
});
