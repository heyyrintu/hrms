import { daysBetween, eachDate, patternDayIndex } from './roster-dates';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('roster-dates', () => {
  it('index cycles with offset', () => {
    expect(patternDayIndex(d('2026-03-16'), d('2026-03-16'), 4, 0)).toBe(0);
    expect(patternDayIndex(d('2026-03-16'), d('2026-03-21'), 4, 0)).toBe(1);
    expect(patternDayIndex(d('2026-03-16'), d('2026-03-16'), 4, 3)).toBe(3);
    expect(patternDayIndex(d('2026-03-16'), d('2026-03-17'), 4, 3)).toBe(0);
  });

  it('eachDate is inclusive and crosses month ends', () => {
    const days = eachDate(d('2026-03-30'), d('2026-04-02'));
    expect(days).toHaveLength(4);
    expect(days.map((x) => x.toISOString().slice(0, 10))).toEqual([
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
    ]);
  });

  it('eachDate is empty when from is after to', () => {
    expect(eachDate(d('2026-03-02'), d('2026-03-01'))).toEqual([]);
  });

  it('daysBetween', () => {
    expect(daysBetween(d('2026-03-16'), d('2026-03-23'))).toBe(7);
  });
});
