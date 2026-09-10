import {
    assessmentYearLabel,
    currentFinancialYear,
    financialYearLabel,
} from './financialYear';

describe('currentFinancialYear', () => {
    it('starts the year on 1 April', () => {
        expect(currentFinancialYear(new Date('2026-04-01T06:00:00Z'))).toBe(2026);
        expect(currentFinancialYear(new Date('2026-12-31T06:00:00Z'))).toBe(2026);
        expect(currentFinancialYear(new Date('2027-03-31T06:00:00Z'))).toBe(2026);
    });

    it('turns the year over on Indian time, not the reader\'s', () => {
        // 20:00 UTC on 31 March is already 01:30 on 1 April in India, so the new
        // financial year has begun. A browser in New York is still on 31 March
        // and would otherwise default an Indian payroll page to the year that
        // closed the night before.
        expect(currentFinancialYear(new Date('2026-03-31T20:00:00Z'))).toBe(2026);
    });

    it('does not turn over early for a reader ahead of India', () => {
        // 21:00 UTC on 31 March 2027 is 06:00 on 1 April in Tokyo but only
        // 02:30 in India, so it is still FY 2026-27 there.
        expect(currentFinancialYear(new Date('2027-03-31T18:00:00Z'))).toBe(2026);
        expect(currentFinancialYear(new Date('2027-03-31T18:31:00Z'))).toBe(2027);
    });
});

describe('labels', () => {
    it('names the financial year by the year it opens', () => {
        expect(financialYearLabel(2026)).toBe('FY 2026-27');
        expect(financialYearLabel(2029)).toBe('FY 2029-30');
        // The century roll has to keep two digits, not print "FY 2099-0".
        expect(financialYearLabel(2099)).toBe('FY 2099-00');
    });

    it('names the assessment year as the one after', () => {
        expect(assessmentYearLabel(2026)).toBe('AY 2027-28');
    });
});
