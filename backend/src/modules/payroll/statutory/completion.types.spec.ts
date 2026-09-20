import { Decimal } from '@prisma/client/runtime/library';
import {
  capTaxAtPayable,
  ltaBlockLabel,
  ltaBlockStartYear,
  ltaJourneysRemaining,
} from './completion.types';

describe('ltaBlockStartYear', () => {
  it('uses the statutory blocks, which are fixed and absolute', () => {
    // 2018-2021, 2022-2025, 2026-2029. These are set by the Act, not chosen.
    expect(ltaBlockStartYear(2018)).toBe(2018);
    expect(ltaBlockStartYear(2021)).toBe(2018);
    expect(ltaBlockStartYear(2022)).toBe(2022);
    expect(ltaBlockStartYear(2025)).toBe(2022);
    expect(ltaBlockStartYear(2026)).toBe(2026);
  });

  it('handles a year before the anchor without running off the end', () => {
    expect(ltaBlockStartYear(2017)).toBe(2014);
    expect(ltaBlockStartYear(2014)).toBe(2014);
  });

  it('names the block for an employee to recognise', () => {
    expect(ltaBlockLabel(2026)).toBe('2026-2029');
    expect(ltaBlockLabel(2025)).toBe('2022-2025');
  });
});

describe('ltaJourneysRemaining', () => {
  it('allows two journeys in a block and no more', () => {
    expect(ltaJourneysRemaining(0)).toBe(2);
    expect(ltaJourneysRemaining(1)).toBe(1);
    expect(ltaJourneysRemaining(2)).toBe(0);
  });

  it('does not go negative when more were somehow recorded than allowed', () => {
    // The employee declares this figure, so it can be wrong. Nothing good
    // comes of a negative count feeding an exemption calculation.
    expect(ltaJourneysRemaining(3)).toBe(0);
    expect(ltaJourneysRemaining(-1)).toBe(2);
  });
});

describe('capTaxAtPayable', () => {
  it('deducts the whole tax when the settlement can carry it', () => {
    const r = capTaxAtPayable(new Decimal(50000), new Decimal(200000));

    expect(r.deducted.toString()).toBe('50000');
    expect(r.uncollected.toString()).toBe('0');
  });

  it('deducts no more than is being paid, and says what was left', () => {
    // An employer cannot deduct tax from a payment that does not exist. The
    // balance is the leaver's own liability on assessment, and hiding it
    // inside a negative net payable would tell nobody that.
    const r = capTaxAtPayable(new Decimal(90000), new Decimal(30000));

    expect(r.deducted.toString()).toBe('30000');
    expect(r.uncollected.toString()).toBe('60000');
  });

  it('deducts nothing when recoveries have already consumed the settlement', () => {
    const r = capTaxAtPayable(new Decimal(40000), new Decimal(0));

    expect(r.deducted.toString()).toBe('0');
    expect(r.uncollected.toString()).toBe('40000');
  });

  it('deducts nothing when the settlement is already negative', () => {
    // Notice recovery can legitimately leave a leaver owing the employer.
    // Tax must not deepen that hole.
    const r = capTaxAtPayable(new Decimal(40000), new Decimal(-5000));

    expect(r.deducted.toString()).toBe('0');
    expect(r.uncollected.toString()).toBe('40000');
  });
});
