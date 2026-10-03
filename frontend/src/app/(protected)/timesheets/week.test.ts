import {
  addDays,
  addMonths,
  dayHeader,
  firstOfMonth,
  formatHours,
  lastOfMonth,
  mondayOf,
  todayIso,
  weekDays,
} from './week';

describe('timesheet week helpers', () => {
  it('mondayOf snaps any day, Sunday included, back to its Monday', () => {
    expect(mondayOf('2026-03-16')).toBe('2026-03-16'); // Monday
    expect(mondayOf('2026-03-18')).toBe('2026-03-16'); // Wednesday
    expect(mondayOf('2026-03-22')).toBe('2026-03-16'); // Sunday
    expect(mondayOf('2026-03-23')).toBe('2026-03-23');
  });

  it('weekDays lists Monday to Sunday, across a month end', () => {
    expect(weekDays('2026-03-30')).toEqual([
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-04',
      '2026-04-05',
    ]);
  });

  it('addDays is not thrown by daylight saving', () => {
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('todayIso uses the local calendar date', () => {
    expect(todayIso(new Date(2026, 2, 5, 23, 30))).toBe('2026-03-05');
  });

  it('dayHeader and formatHours', () => {
    expect(dayHeader('2026-03-16')).toBe('Mon 16');
    expect(formatHours(8)).toBe('8');
    expect(formatHours(7.5)).toBe('7.5');
    expect(formatHours(0.1 + 0.2)).toBe('0.3');
  });

  it('month helpers', () => {
    expect(firstOfMonth('2026-02-17')).toBe('2026-02-01');
    expect(lastOfMonth('2026-02-17')).toBe('2026-02-28');
    expect(lastOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });
});
