import { Decimal } from '@prisma/client/runtime/library';
import {
  allocateLoanRecovery,
  readStoredLoanRecovery,
  toStoredLoanRecovery,
} from './loan-recovery';

describe('allocateLoanRecovery', () => {
  const loan = (loanId: string, outstanding: string, type = 'LOAN') => ({
    loanId,
    type,
    outstanding: new Decimal(outstanding),
  });

  it('recovers every balance in full when the settlement can bear it', () => {
    const result = allocateLoanRecovery(
      [loan('l1', '50000.00'), loan('l2', '10000.00', 'SALARY_ADVANCE')],
      new Decimal('290114.14'),
    );

    expect(result.total.toFixed(2)).toBe('60000.00');
    expect(result.unrecovered.toFixed(2)).toBe('0.00');
    expect(result.lines).toEqual([
      expect.objectContaining({ loanId: 'l1', recovered: new Decimal('50000.00') }),
      expect.objectContaining({ loanId: 'l2', recovered: new Decimal('10000.00') }),
    ]);
  });

  it('stops at the net payable, oldest loan first, and names what is left', () => {
    const result = allocateLoanRecovery(
      [loan('l1', '50000.00'), loan('l2', '10000.00')],
      new Decimal('55000.00'),
    );

    expect(result.total.toFixed(2)).toBe('55000.00');
    expect(result.unrecovered.toFixed(2)).toBe('5000.00');
    expect(result.lines[0].recovered.toFixed(2)).toBe('50000.00');
    expect(result.lines[0].unrecovered.toFixed(2)).toBe('0.00');
    expect(result.lines[1].recovered.toFixed(2)).toBe('5000.00');
    expect(result.lines[1].unrecovered.toFixed(2)).toBe('5000.00');
  });

  it('recovers nothing from a settlement that is already at or below zero', () => {
    const result = allocateLoanRecovery(
      [loan('l1', '50000.00')],
      new Decimal('-1200.00'),
    );

    expect(result.total.toFixed(2)).toBe('0.00');
    expect(result.unrecovered.toFixed(2)).toBe('50000.00');
    expect(result.available.toFixed(2)).toBe('0.00');
  });

  it('labels each line by what kind of borrowing it was', () => {
    const result = allocateLoanRecovery(
      [loan('l1', '100.00'), loan('l2', '100.00', 'SALARY_ADVANCE')],
      new Decimal('1000.00'),
    );

    expect(result.lines[0].label).toMatch(/^Loan recovery/);
    expect(result.lines[1].label).toMatch(/^Salary advance recovery/);
  });

  it('is empty with no loans', () => {
    const result = allocateLoanRecovery([], new Decimal('1000.00'));

    expect(result.lines).toEqual([]);
    expect(result.total.toFixed(2)).toBe('0.00');
  });
});

describe('stored loan recovery', () => {
  it('round-trips through the breakdown JSON', () => {
    const allocated = allocateLoanRecovery(
      [{ loanId: 'l1', type: 'LOAN', outstanding: new Decimal('5000.00') }],
      new Decimal('3000.00'),
    );

    const stored = toStoredLoanRecovery(allocated);
    expect(stored).toMatchObject({
      total: '3000.00',
      unrecovered: '2000.00',
      available: '3000.00',
      loans: [
        {
          loanId: 'l1',
          type: 'LOAN',
          outstanding: '5000.00',
          recovered: '3000.00',
          unrecovered: '2000.00',
        },
      ],
    });

    const read = readStoredLoanRecovery({ loanRecovery: JSON.parse(JSON.stringify(stored)) });
    expect(read).toEqual([
      { loanId: 'l1', type: 'LOAN', outstanding: new Decimal('5000.00'), recovered: new Decimal('3000.00') },
    ]);
  });

  it('reads nothing from a breakdown that predates loan recovery', () => {
    expect(readStoredLoanRecovery(null)).toEqual([]);
    expect(readStoredLoanRecovery({ totals: {} })).toEqual([]);
  });

  it('refuses a malformed stored line rather than trusting it into money', () => {
    expect(() =>
      readStoredLoanRecovery({
        loanRecovery: { loans: [{ loanId: 'l1', outstanding: 'abc', recovered: '1' }] },
      }),
    ).toThrow();
  });
});
