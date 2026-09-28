import {
  ENGAGEMENT_TIME_ZONE,
  istDateParts,
  istMonthRange,
  istPeriodRange,
  istStartOfDay,
} from './engagement-time';

describe('engagement-time (IST helpers)', () => {
  it('uses Asia/Kolkata', () => {
    expect(ENGAGEMENT_TIME_ZONE).toBe('Asia/Kolkata');
  });

  describe('istDateParts', () => {
    it('reads 18:00 UTC on 31 March as 23:30 IST on 31 March', () => {
      expect(istDateParts(new Date('2026-03-31T18:00:00Z'))).toEqual({
        year: 2026,
        month: 3,
        day: 31,
      });
    });

    it('reads 19:00 UTC on 31 March as 00:30 IST on 1 April', () => {
      expect(istDateParts(new Date('2026-03-31T19:00:00Z'))).toEqual({
        year: 2026,
        month: 4,
        day: 1,
      });
    });

    it('rolls the year over at IST midnight on 31 December', () => {
      expect(istDateParts(new Date('2026-12-31T18:30:00Z'))).toEqual({
        year: 2027,
        month: 1,
        day: 1,
      });
    });
  });

  describe('istStartOfDay', () => {
    it('returns the UTC instant of IST midnight for the IST date', () => {
      expect(istStartOfDay(new Date('2026-03-15T12:00:00Z')).toISOString()).toBe(
        '2026-03-14T18:30:00.000Z',
      );
    });

    it('uses the IST date, not the UTC date, just after IST midnight', () => {
      // 00:30 IST on 1 April
      expect(istStartOfDay(new Date('2026-03-31T19:00:00Z')).toISOString()).toBe(
        '2026-03-31T18:30:00.000Z',
      );
    });
  });

  describe('istMonthRange', () => {
    it('puts 23:30 IST on 31 March in March', () => {
      const { start, end } = istMonthRange(new Date('2026-03-31T18:00:00Z'));
      expect(start.toISOString()).toBe('2026-02-28T18:30:00.000Z');
      expect(end.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    });

    it('puts 00:30 IST on 1 April in April', () => {
      const { start, end } = istMonthRange(new Date('2026-03-31T19:00:00Z'));
      expect(start.toISOString()).toBe('2026-03-31T18:30:00.000Z');
      expect(end.toISOString()).toBe('2026-04-30T18:30:00.000Z');
    });

    it('rolls December over into the next year', () => {
      const { start, end } = istMonthRange(new Date('2026-12-15T12:00:00Z'));
      expect(start.toISOString()).toBe('2026-11-30T18:30:00.000Z');
      expect(end.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    });

    it('is half-open: the end instant belongs to the next month', () => {
      const { end } = istMonthRange(new Date('2026-03-31T18:00:00Z'));
      expect(istMonthRange(end).start.getTime()).toBe(end.getTime());
    });
  });

  describe('istPeriodRange', () => {
    const now = new Date('2026-05-10T12:00:00Z');

    it('month matches istMonthRange', () => {
      const { start, end } = istPeriodRange('month', now);
      expect(start?.toISOString()).toBe('2026-04-30T18:30:00.000Z');
      expect(end?.toISOString()).toBe('2026-05-31T18:30:00.000Z');
    });

    it('quarter runs from 1 April IST to 1 July IST', () => {
      const { start, end } = istPeriodRange('quarter', now);
      expect(start?.toISOString()).toBe('2026-03-31T18:30:00.000Z');
      expect(end?.toISOString()).toBe('2026-06-30T18:30:00.000Z');
    });

    it('Q4 rolls into January of the next year', () => {
      const { start, end } = istPeriodRange('quarter', new Date('2026-11-20T12:00:00Z'));
      expect(start?.toISOString()).toBe('2026-09-30T18:30:00.000Z');
      expect(end?.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    });

    it('year runs from 1 January IST to the next 1 January IST', () => {
      const { start, end } = istPeriodRange('year', now);
      expect(start?.toISOString()).toBe('2025-12-31T18:30:00.000Z');
      expect(end?.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    });

    it("'all' has no bounds", () => {
      expect(istPeriodRange('all', now)).toEqual({ start: null, end: null });
    });
  });
});
