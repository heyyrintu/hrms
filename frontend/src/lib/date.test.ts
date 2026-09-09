import { parseLocalDate, toLocalIso, todayLocalIso, isWeekend } from './date';

describe('parseLocalDate', () => {
  it('keeps the calendar day the string names, not the UTC instant', () => {
    const d = parseLocalDate('2026-09-14');

    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(14);
  });

  it('reports the weekday of the named day', () => {
    // 2026-09-14 is a Monday. `new Date('2026-09-14').getDay()` returns Sunday
    // for anyone west of UTC, which is what broke weekend exclusion.
    expect(parseLocalDate('2026-09-14').getDay()).toBe(1);
    expect(isWeekend(parseLocalDate('2026-09-14'))).toBe(false);
    expect(isWeekend(parseLocalDate('2026-09-12'))).toBe(true); // Saturday
    expect(isWeekend(parseLocalDate('2026-09-13'))).toBe(true); // Sunday
  });
});

describe('toLocalIso', () => {
  it('formats from local calendar fields', () => {
    expect(toLocalIso(new Date(2026, 8, 14))).toBe('2026-09-14');
  });

  it('does not roll back a late-evening date the way toISOString does', () => {
    // 23:30 local on the 14th is the 15th in UTC for positive offsets, and
    // toISOString would report the wrong calendar day.
    const lateEvening = new Date(2026, 8, 14, 23, 30);
    expect(toLocalIso(lateEvening)).toBe('2026-09-14');
  });

  it('pads single-digit months and days', () => {
    expect(toLocalIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('todayLocalIso', () => {
  it('agrees with the local calendar date', () => {
    const now = new Date();
    expect(todayLocalIso()).toBe(toLocalIso(now));
  });
});
