import {
  computeLateMark,
  minutesSinceMidnightInZone,
  parseHhMm,
  zonedDateOnlyUtc,
} from './late-mark';

describe('parseHhMm', () => {
  it('parses a well formed clock time', () => {
    expect(parseHhMm('09:00')).toBe(540);
    expect(parseHhMm('9:05')).toBe(545);
    expect(parseHhMm('00:00')).toBe(0);
    expect(parseHhMm('23:59')).toBe(1439);
  });

  it('returns null for anything that is not a clock time', () => {
    expect(parseHhMm('')).toBeNull();
    expect(parseHhMm('nine')).toBeNull();
    expect(parseHhMm('24:00')).toBeNull();
    expect(parseHhMm('09:60')).toBeNull();
  });
});

describe('minutesSinceMidnightInZone', () => {
  it('reads the wall clock in Asia/Kolkata, not in UTC', () => {
    // 03:30 UTC is 09:00 IST (UTC+5:30).
    expect(minutesSinceMidnightInZone(new Date('2026-03-15T03:30:00Z'))).toBe(540);
  });

  it('rolls over the date boundary', () => {
    // 18:35 UTC on the 15th is 00:05 IST on the 16th.
    expect(minutesSinceMidnightInZone(new Date('2026-03-15T18:35:00Z'))).toBe(5);
  });
});

describe('computeLateMark', () => {
  it('is not late when the punch lands exactly on the shift start', () => {
    // 09:00 IST
    expect(computeLateMark(new Date('2026-03-15T03:30:00Z'), '09:00', 15)).toEqual({
      isLate: false,
      lateByMinutes: 0,
    });
  });

  it('is not late when the punch is early', () => {
    // 08:40 IST
    expect(computeLateMark(new Date('2026-03-15T03:10:00Z'), '09:00', 15)).toEqual({
      isLate: false,
      lateByMinutes: 0,
    });
  });

  it('is not late inside the grace window, including its last minute', () => {
    // 09:15 IST, grace 15 -> the threshold itself is still on time.
    expect(computeLateMark(new Date('2026-03-15T03:45:00Z'), '09:00', 15)).toEqual({
      isLate: false,
      lateByMinutes: 0,
    });
  });

  it('is late past the grace window and counts from the end of grace', () => {
    // 09:42 IST, grace 15 -> 27 minutes past 09:15.
    expect(computeLateMark(new Date('2026-03-15T04:12:00Z'), '09:00', 15)).toEqual({
      isLate: true,
      lateByMinutes: 27,
    });
  });

  it('treats a zero grace as no grace at all', () => {
    // 09:01 IST
    expect(computeLateMark(new Date('2026-03-15T03:31:00Z'), '09:00', 0)).toEqual({
      isLate: true,
      lateByMinutes: 1,
    });
  });

  it('handles a midnight shift start across the UTC date boundary', () => {
    // 00:05 IST on the 16th against a 00:00 shift with 15 minutes grace.
    expect(computeLateMark(new Date('2026-03-15T18:35:00Z'), '00:00', 15)).toEqual({
      isLate: false,
      lateByMinutes: 0,
    });
    // 00:20 IST on the 16th -> 5 minutes past the 00:15 threshold.
    expect(computeLateMark(new Date('2026-03-15T18:50:00Z'), '00:00', 15)).toEqual({
      isLate: true,
      lateByMinutes: 5,
    });
  });

  it('never marks late when the shift start is unusable', () => {
    expect(computeLateMark(new Date('2026-03-15T12:00:00Z'), 'not-a-time', 15)).toEqual({
      isLate: false,
      lateByMinutes: 0,
    });
  });

  it('honours an explicit time zone', () => {
    // 03:30 UTC is 03:30 in UTC itself, which is well before a 09:00 start.
    expect(computeLateMark(new Date('2026-03-15T03:30:00Z'), '09:00', 0, 'UTC')).toEqual({
      isLate: false,
      lateByMinutes: 0,
    });
  });
});

describe('zonedDateOnlyUtc', () => {
  it('returns the IST calendar day as a UTC midnight date', () => {
    expect(zonedDateOnlyUtc(new Date('2026-03-15T18:35:00Z')).toISOString()).toBe(
      '2026-03-16T00:00:00.000Z',
    );
    expect(zonedDateOnlyUtc(new Date('2026-03-15T12:00:00Z')).toISOString()).toBe(
      '2026-03-15T00:00:00.000Z',
    );
  });
});
