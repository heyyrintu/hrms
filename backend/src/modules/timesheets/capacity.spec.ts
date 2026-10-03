import { capacityHours, pct } from './capacity';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const base = {
  joinDate: d('2020-01-01'),
  exitDate: null,
  holidays: new Set<string>(),
  leaveDays: new Map<string, number>(),
  standardMinutesByDate: new Map<string, number>(),
};

describe('capacityHours', () => {
  it('Mon-Fri at 8h', () =>
    expect(capacityHours({ ...base, from: d('2026-03-16'), to: d('2026-03-22') })).toBe(40));

  it('holiday on a weekday removes a day; on Saturday removes nothing', () =>
    expect(
      capacityHours({
        ...base,
        from: d('2026-03-16'),
        to: d('2026-03-22'),
        holidays: new Set(['2026-03-17', '2026-03-21']),
      }),
    ).toBe(32));

  it('half-day leave removes half the day', () =>
    expect(
      capacityHours({
        ...base,
        from: d('2026-03-16'),
        to: d('2026-03-22'),
        leaveDays: new Map([['2026-03-18', 0.5]]),
      }),
    ).toBe(36));

  it('uses the shift standard minutes', () =>
    expect(
      capacityHours({
        ...base,
        from: d('2026-03-16'),
        to: d('2026-03-16'),
        standardMinutesByDate: new Map([['2026-03-16', 540]]),
      }),
    ).toBe(9));

  it('clips to join and exit', () =>
    expect(
      capacityHours({
        ...base,
        from: d('2026-03-16'),
        to: d('2026-03-22'),
        joinDate: d('2026-03-18'),
        exitDate: d('2026-03-19'),
      }),
    ).toBe(16));

  it('weekend-only range', () =>
    expect(capacityHours({ ...base, from: d('2026-03-21'), to: d('2026-03-22') })).toBe(0));

  it('a full-day leave removes the whole day, and leave is capped at one day', () =>
    expect(
      capacityHours({
        ...base,
        from: d('2026-03-16'),
        to: d('2026-03-16'),
        leaveDays: new Map([['2026-03-16', 3]]),
      }),
    ).toBe(0));

  it('a standard of 0 minutes on a day gives no capacity for it', () =>
    expect(
      capacityHours({
        ...base,
        from: d('2026-03-16'),
        to: d('2026-03-17'),
        standardMinutesByDate: new Map([['2026-03-16', 0]]),
      }),
    ).toBe(8));

  it('compares join and exit as IST calendar days, not UTC instants', () => {
    // 20:00 UTC on the 17th is 01:30 IST on the 18th: the 18th is the join day.
    expect(
      capacityHours({
        ...base,
        from: d('2026-03-16'),
        to: d('2026-03-22'),
        joinDate: new Date('2026-03-17T20:00:00.000Z'),
      }),
    ).toBe(24);
  });

  it('rounds to two decimals', () =>
    expect(
      capacityHours({
        ...base,
        from: d('2026-03-16'),
        to: d('2026-03-16'),
        standardMinutesByDate: new Map([['2026-03-16', 500]]),
      }),
    ).toBe(8.33));
});

describe('pct', () => {
  it('rounds to one decimal and is null when the denominator is 0', () => {
    expect(pct(30, 40)).toBe(75);
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(5, 0)).toBeNull();
  });
});
