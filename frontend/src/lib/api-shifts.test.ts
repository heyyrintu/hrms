import { isOvernightShift } from './api-shifts';

describe('isOvernightShift', () => {
    it('is true when the shift ends on the next day', () => {
        expect(isOvernightShift('22:00', '06:00')).toBe(true);
        expect(isOvernightShift('18:00', '00:00')).toBe(true);
    });

    it('treats an equal start and end as a 24-hour shift', () => {
        expect(isOvernightShift('08:00', '08:00')).toBe(true);
    });

    it('is false for a same-day shift', () => {
        expect(isOvernightShift('09:00', '18:00')).toBe(false);
        expect(isOvernightShift('00:00', '08:00')).toBe(false);
    });

    it('is false while either time is missing or malformed', () => {
        expect(isOvernightShift('', '06:00')).toBe(false);
        expect(isOvernightShift('22:00', undefined)).toBe(false);
        expect(isOvernightShift('25:00', '06:00')).toBe(false);
    });
});
