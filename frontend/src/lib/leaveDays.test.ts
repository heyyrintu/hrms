import { availableDays, formatDays } from './leaveDays';

/**
 * Leave day counts arrive as decimal strings, because LeaveBalance holds them
 * as Prisma `Decimal(5, 2)`. Adding two of those with `+` concatenates them,
 * so these are the two things that must not be done with plain arithmetic.
 */
describe('availableDays', () => {
  it('adds and subtracts decimal strings rather than concatenating them', () => {
    expect(
      availableDays({
        totalDays: '12.00',
        carriedOver: '3.00',
        usedDays: '2.00',
        pendingDays: '1.50',
      }),
    ).toBe('11.50');
  });

  it('credits half days exactly', () => {
    expect(
      availableDays({
        totalDays: '10.50',
        carriedOver: '0.00',
        usedDays: '0.50',
        pendingDays: '0.00',
      }),
    ).toBe('10.00');
  });

  it('goes negative when more is used than granted, rather than hiding it', () => {
    expect(
      availableDays({
        totalDays: '5.00',
        carriedOver: '0.00',
        usedDays: '6.00',
        pendingDays: '0.50',
      }),
    ).toBe('-1.50');
  });

  it('treats a missing figure as zero', () => {
    expect(
      availableDays({ totalDays: '7.00', carriedOver: '', usedDays: '0.00' }),
    ).toBe('7.00');
  });

  it('still adds numbers, for balances built in the browser', () => {
    expect(
      availableDays({ totalDays: 12, carriedOver: 3, usedDays: 2, pendingDays: 1.5 }),
    ).toBe('11.50');
  });
});

describe('formatDays', () => {
  it.each([
    ['11.50', '11.5'],
    ['12.00', '12'],
    ['0.00', '0'],
    ['0.50', '0.5'],
    ['-1.50', '-1.5'],
    ['7.25', '7.25'],
  ])('shows %s as %s', (value, expected) => {
    expect(formatDays(value)).toBe(expected);
  });

  it('keeps a figure it cannot read, rather than showing NaN', () => {
    expect(formatDays('')).toBe('0');
    expect(formatDays('n/a')).toBe('n/a');
  });
});
