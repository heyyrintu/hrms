import { parseLadderError } from './ladderErrors';

/**
 * The server names a band by the amount it starts at, not by a number.
 *
 * These are its real messages, copied from `slabs.service.ts`. A parser that
 * expected "Band 3" would match none of them, and every refusal would float in
 * a banner the reader has to match against the ladder by hand.
 */
const bands = [
    { fromAmount: '0' },
    { fromAmount: '400000' },
    { fromAmount: '800000' },
];

describe('parseLadderError', () => {
    it('attaches a gap to the band the server named by its lower bound', () => {
        const message =
            'The band starting at 400000.00 has an upper bound of 700000.00, but the next ' +
            'band starts at 800000.00, leaving the income between them taxed at nothing';

        expect(parseLadderError(message, bands).bandIndex).toBe(1);
    });

    it('attaches a ladder that does not start at zero to the lowest band', () => {
        // A ladder refused for not starting at zero has a lowest band that is
        // not zero, so the bands on screen are the offending ones.
        const offending = [{ fromAmount: '250000' }, { fromAmount: '500000' }];
        const message =
            'The ladder must start at 0; its lowest band starts at 250000.00';

        expect(parseLadderError(message, offending).bandIndex).toBe(0);
    });

    it('names no band when the refusal is about the ladder as a whole', () => {
        const message =
            'Exactly one band must be open-ended at the top so income above the highest ' +
            'bound is still taxed; none of the bands given is';

        expect(parseLadderError(message, bands).bandIndex).toBeNull();
    });

    it('names no band when the amount belongs to no band on screen', () => {
        const message = 'The band starting at 999999.00 has an upper bound of 1.00';

        expect(parseLadderError(message, bands).bandIndex).toBeNull();
    });

    it('hands the message back unchanged either way', () => {
        const message = 'The ladder must start at 0; its lowest band starts at 250000.00';

        expect(parseLadderError(message, bands).message).toBe(message);
        expect(parseLadderError('anything at all', bands).message).toBe('anything at all');
    });
});
