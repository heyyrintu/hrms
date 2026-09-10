import { formatMoney, toPayloadNumber } from './format';

describe('formatMoney', () => {
    it('formats a decimal string exactly, without a float in between', () => {
        expect(formatMoney('151987.15')).toBe('₹1,51,987.15');
    });

    it('treats an absent figure as nil rather than blank', () => {
        expect(formatMoney(null)).toBe('₹0.00');
        expect(formatMoney('  ')).toBe('₹0.00');
    });

    it('shows an unparseable figure as it arrived rather than as a wrong number', () => {
        // Intl.NumberFormat turns an invalid string into NaN instead of
        // throwing, so a try/catch never fires. Rendering a settlement line as
        // "₹NaN" tells the reader nothing and looks like a broken app; showing
        // the raw value at least says what the server sent.
        expect(formatMoney('abc')).toBe('abc');
        expect(formatMoney('12,000')).toBe('12,000');
        expect(formatMoney('1e5')).toBe('1e5');
    });

    it('keeps a negative figure negative', () => {
        expect(formatMoney('-2500.00')).toBe('-₹2,500.00');
    });
});

describe('toPayloadNumber', () => {
    it('converts an entered decimal to the number the payload validates', () => {
        expect(toPayloadNumber('4500.50')).toBe(4500.5);
        expect(toPayloadNumber(' 0 ')).toBe(0);
    });

    it('treats a cleared box as a deliberate zero', () => {
        // The form is prefilled, so an empty field is the user saying "nothing
        // under this head", not "leave whatever was there".
        expect(toPayloadNumber('')).toBe(0);
        expect(toPayloadNumber('   ')).toBe(0);
    });

    it('refuses a value it cannot read rather than sending zero', () => {
        // Silently sending 0 for an unreadable entry would write a figure
        // nobody typed to a settlement someone is about to be paid from.
        expect(toPayloadNumber('abc')).toBeNull();
        expect(toPayloadNumber('12,000')).toBeNull();
    });

    it('accepts the exponent form a number input will hand back', () => {
        expect(toPayloadNumber('1e5')).toBe(100000);
    });

    it('refuses a negative, which the server rejects anyway', () => {
        expect(toPayloadNumber('-1')).toBeNull();
    });
});
