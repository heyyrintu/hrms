import {
  calculateSalaryBreakdown,
  formatCurrency,
  isPositiveMoney,
  sumMoney,
} from './salaryCalculations';
import type { SalaryComponent } from '@/types';

/**
 * Money from the payroll API arrives as a decimal string, because the backend
 * holds these columns as Prisma `Decimal`. These tests pin the two things that
 * must not go through a JavaScript float on the way to the screen: formatting
 * a single figure, and adding several of them together.
 */
describe('formatCurrency', () => {
  it('formats a decimal string without parsing it into a float', () => {
    expect(formatCurrency('1234567.89')).toBe('₹12,34,568');
  });

  it('never round-trips the figure through a float', () => {
    // Every figure a Decimal(14,2) column can hold survives Number(), so no
    // realistic value proves this on its own. 2^53 + 1 does: parsed as a float
    // it comes back as ...992. Formatting the string keeps the ...993.
    expect(formatCurrency('9007199254740993')).toBe('₹9,00,71,99,25,47,40,993');
  });

  it('still formats a plain number, for figures computed in the browser', () => {
    expect(formatCurrency(100000)).toBe('₹1,00,000');
  });
});

describe('sumMoney', () => {
  /**
   * Three plausible monthly payroll totals whose exact sum ends in .50.
   * Added as floats they come to 7948158.499999999, which displays as one
   * rupee less than was actually paid out.
   */
  const runTotals = ['448631.64', '6898878.10', '600648.76'];

  it('adds decimal strings exactly, where floats drift below the true total', () => {
    expect(sumMoney(runTotals)).toBe('7948158.50');
  });

  it('is the figure a float sum gets wrong', () => {
    const floatSum = runTotals.reduce((total, value) => total + Number(value), 0);
    expect(formatCurrency(floatSum)).toBe('₹79,48,158');
    expect(formatCurrency(sumMoney(runTotals))).toBe('₹79,48,159');
  });

  it('sums an empty list to zero', () => {
    expect(sumMoney([])).toBe('0.00');
  });

  it('handles negative figures, such as a net recovery', () => {
    expect(sumMoney(['1000.00', '-250.50'])).toBe('749.50');
  });

  it('refuses a value that is not a decimal, rather than silently dropping it', () => {
    expect(() => sumMoney(['1000.00', 'not-a-number'])).toThrow(/not-a-number/);
  });
});

describe('isPositiveMoney', () => {
  it.each([
    ['0.00', false],
    ['0', false],
    ['0.01', true],
    ['12345.67', true],
    ['-250.50', false],
    ['-0.00', false],
  ])('reads %s as %s without parsing it into a float', (value, expected) => {
    expect(isPositiveMoney(value)).toBe(expected);
  });

  it('still reads a number, for figures computed in the browser', () => {
    expect(isPositiveMoney(0)).toBe(false);
    expect(isPositiveMoney(1500)).toBe(true);
  });
});

describe('calculateSalaryBreakdown', () => {
  const components: SalaryComponent[] = [
    { name: 'HRA', type: 'earning', calcType: 'percentage', value: 40 },
    { name: 'Transport', type: 'earning', calcType: 'fixed', value: 2000 },
    { name: 'PF', type: 'deduction', calcType: 'percentage', value: 12 },
  ];

  it('previews earnings, deductions and net from a base pay entered in the browser', () => {
    const breakdown = calculateSalaryBreakdown(50000, components);

    expect(breakdown.earnings).toEqual([
      { name: 'Base Pay', amount: 50000 },
      { name: 'HRA', amount: 20000 },
      { name: 'Transport', amount: 2000 },
    ]);
    expect(breakdown.deductions).toEqual([{ name: 'PF', amount: 6000 }]);
    expect(breakdown.grossPay).toBe(72000);
    expect(breakdown.totalDeductions).toBe(6000);
    expect(breakdown.netPay).toBe(66000);
  });
});
