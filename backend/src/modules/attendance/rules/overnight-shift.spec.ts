import {
  carriedSessionWindowMinutes,
  clockInBelongsToPreviousShift,
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

  // A 24-hour shift has no off-duty gap to split. With the cutoff on the end
  // time, arriving ten minutes early for today's 08:00 start was filed as a
  // punch 23h50 into yesterday's shift.
  it('leaves a 24-hour shift a two-hour early-arrival window before its start', () => {
    expect(overnightDayCutoffMinutes('08:00', '08:00')).toBe(6 * 60);
  });

  it('never puts a 24-hour cutoff before midnight', () => {
    expect(overnightDayCutoffMinutes('01:00', '01:00')).toBe(0);
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

describe('clockInBelongsToPreviousShift', () => {
  const night = { startTime: '22:00', endTime: '06:00' };
  const day = { startTime: '09:00', endTime: '18:00' };
  const early = { startTime: '07:00', endTime: '16:00' };
  const allDay = { startTime: '08:00', endTime: '08:00' };
  // IST instants on the 17th.
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(Date.UTC(2026, 2, 17, h, m) - 330 * 60 * 1000);
  };

  it("keeps a punch inside last night's shift on last night", () => {
    expect(clockInBelongsToPreviousShift(at('00:30'), night, night)).toBe(true);
    expect(clockInBelongsToPreviousShift(at('05:00'), night, night)).toBe(true);
  });

  it('allows a short return after the end, for overtime after a break', () => {
    expect(clockInBelongsToPreviousShift(at('07:30'), night, null)).toBe(true);
  });

  // The night assignment ended yesterday and the day shift starts today: a
  // 09:00 arrival is the day shift, not a seventeen-hour night.
  it('gives a morning arrival to today once last night is well over', () => {
    expect(clockInBelongsToPreviousShift(at('09:00'), night, day)).toBe(false);
    expect(clockInBelongsToPreviousShift(at('09:00'), night, null)).toBe(false);
  });

  it("gives the punch to today's shift when its start is nearer", () => {
    // 06:45: 45 min after last night ended, 15 min before today's 07:00.
    expect(clockInBelongsToPreviousShift(at('06:45'), night, early)).toBe(false);
    // 06:10: 10 min after the end, 50 min before the start.
    expect(clockInBelongsToPreviousShift(at('06:10'), night, early)).toBe(true);
  });

  it("never gives yesterday a punch after today's shift has started", () => {
    expect(clockInBelongsToPreviousShift(at('07:05'), night, early)).toBe(false);
  });

  it('is false when yesterday was not an overnight shift', () => {
    expect(clockInBelongsToPreviousShift(at('00:30'), day, night)).toBe(false);
    expect(clockInBelongsToPreviousShift(at('00:30'), null, night)).toBe(false);
  });

  it('treats an early arrival for a 24-hour shift as today', () => {
    expect(clockInBelongsToPreviousShift(at('07:50'), allDay, allDay)).toBe(false);
    expect(clockInBelongsToPreviousShift(at('05:00'), allDay, allDay)).toBe(true);
  });
});

describe('carriedSessionWindowMinutes', () => {
  it('is eighteen hours for an ordinary shift or no shift', () => {
    expect(carriedSessionWindowMinutes({ startTime: '09:00', endTime: '18:00' })).toBe(18 * 60);
    expect(carriedSessionWindowMinutes({ startTime: '22:00', endTime: '06:00' })).toBe(18 * 60);
    expect(carriedSessionWindowMinutes(null)).toBe(18 * 60);
  });

  it('stretches to cover a 24-hour shift plus overrun, and no further', () => {
    expect(carriedSessionWindowMinutes({ startTime: '08:00', endTime: '08:00' })).toBe(26 * 60);
    expect(carriedSessionWindowMinutes({ startTime: '08:00', endTime: '07:00' })).toBe(25 * 60);
  });
});
