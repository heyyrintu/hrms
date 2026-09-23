import {
  isOvernightShift,
  overnightDayCutoffMinutes,
  resolveShiftDate,
} from './overnight-shift';

describe('isOvernightShift', () => {
  it('is true when the end time is on the next calendar day', () => {
    expect(isOvernightShift('22:00', '06:00')).toBe(true);
    expect(isOvernightShift('18:00', '00:00')).toBe(true);
  });

  it('treats an end equal to the start as a 24-hour shift, which crosses midnight', () => {
    expect(isOvernightShift('08:00', '08:00')).toBe(true);
  });

  it('is false for a same-day shift', () => {
    expect(isOvernightShift('09:00', '18:00')).toBe(false);
    expect(isOvernightShift('00:00', '08:00')).toBe(false);
  });

  it('is false when either time is unusable', () => {
    expect(isOvernightShift('22:00', 'nope')).toBe(false);
    expect(isOvernightShift(undefined, '06:00')).toBe(false);
  });
});

describe('overnightDayCutoffMinutes', () => {
  it('splits the off-duty gap in half', () => {
    // Off duty 06:00 -> 22:00, midpoint 14:00.
    expect(overnightDayCutoffMinutes('22:00', '06:00')).toBe(14 * 60);
    // Off duty 04:00 -> 20:00, midpoint 12:00.
    expect(overnightDayCutoffMinutes('20:00', '04:00')).toBe(12 * 60);
  });

  it('is null for a same-day shift', () => {
    expect(overnightDayCutoffMinutes('09:00', '18:00')).toBeNull();
  });
});

describe('resolveShiftDate', () => {
  const night = { startTime: '22:00', endTime: '06:00' };

  it('puts a clock-in shortly after midnight on the day the shift started', () => {
    // 00:30 IST on the 17th.
    expect(resolveShiftDate(new Date('2026-03-16T19:00:00Z'), night).toISOString()).toBe(
      '2026-03-16T00:00:00.000Z',
    );
  });

  it('puts an early clock-in before the start on its own day', () => {
    // 21:55 IST on the 16th.
    expect(resolveShiftDate(new Date('2026-03-16T16:25:00Z'), night).toISOString()).toBe(
      '2026-03-16T00:00:00.000Z',
    );
  });

  it('puts the next morning clock-out on the day the shift started', () => {
    // 06:10 IST on the 17th, a little overtime past 06:00.
    expect(resolveShiftDate(new Date('2026-03-17T00:40:00Z'), night).toISOString()).toBe(
      '2026-03-16T00:00:00.000Z',
    );
  });

  it('rolls over to the new day once the off-duty midpoint has passed', () => {
    // 15:00 IST on the 17th is past the 14:00 cutoff.
    expect(resolveShiftDate(new Date('2026-03-17T09:30:00Z'), night).toISOString()).toBe(
      '2026-03-17T00:00:00.000Z',
    );
  });

  it('leaves a same-day shift on its calendar day, even after midnight', () => {
    // 00:30 IST on the 17th.
    expect(
      resolveShiftDate(new Date('2026-03-16T19:00:00Z'), {
        startTime: '09:00',
        endTime: '18:00',
      }).toISOString(),
    ).toBe('2026-03-17T00:00:00.000Z');
  });

  it('uses the calendar day when there is no shift', () => {
    expect(resolveShiftDate(new Date('2026-03-16T19:00:00Z'), null).toISOString()).toBe(
      '2026-03-17T00:00:00.000Z',
    );
  });
});
