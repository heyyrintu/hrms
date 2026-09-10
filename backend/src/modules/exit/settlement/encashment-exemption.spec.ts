import { Decimal } from '@prisma/client/runtime/library';
import { calculateEncashmentExemption } from './encashment-exemption';
import type {
  EncashmentExemptionConfig,
  EncashmentExemptionInput,
} from '../../payroll/statutory/tax-correctness.types';

const d = (n: number | string) => new Decimal(n);

/** The figures the section fixes, as a tenant would normally hold them. */
const config = (
  over: Partial<EncashmentExemptionConfig> = {},
): EncashmentExemptionConfig => ({
  exemptionCap: d(2500000),
  exemptDaysPerYear: d(30),
  exemptMonths: d(10),
  governmentEmployer: false,
  ...over,
});

const input = (
  over: Partial<EncashmentExemptionInput> = {},
): EncashmentExemptionInput => ({
  amountPaid: d(400000),
  averageMonthlySalary: d(60000),
  completedYears: d(5),
  daysEncashed: d(200),
  exemptionAlreadyUsed: d(0),
  ...over,
});

describe('calculateEncashmentExemption: which limb binds', () => {
  it('is limited by 30 days a year when the employer allows a longer carry-forward', () => {
    // Average salary 60,000 a month, so a statutory day is 60,000 / 30 = 2,000.
    // 200 days paid at 2,000 = 4,00,000 actually received.
    //
    //   1. received                          4,00,000
    //   2. ceiling                          25,00,000
    //   3. ten months' salary  60,000 x 10 = 6,00,000
    //   4. 30 days x 5 years = 150 days, capped from the 200 encashed:
    //      150 / 30 = 5 months x 60,000    = 3,00,000   <- least
    //
    // Exempt 3,00,000; the remaining 1,00,000 is taxable as salary.
    const r = calculateEncashmentExemption(input(), config());

    expect(r.limitedBy).toBe('LEAVE_DAYS_PER_YEAR');
    expect(r.exempt.toFixed(2)).toBe('300000.00');
    expect(r.taxable.toFixed(2)).toBe('100000.00');
    expect(r.limbs.amountPaid.toFixed(2)).toBe('400000.00');
    expect(r.limbs.statutoryCapRemaining.toFixed(2)).toBe('2500000.00');
    expect(r.limbs.averageSalaryMonths.toFixed(2)).toBe('600000.00');
    expect(r.limbs.leaveDaysPerYear.toFixed(2)).toBe('300000.00');
  });

  it('is limited by ten months of salary once long service unlocks more leave days', () => {
    // Twenty completed years permits 30 x 20 = 600 days, so the 400 days
    // encashed all qualify: 400 / 30 = 13.3333 months, which is more than the
    // ten months the section allows.
    //
    //   1. received  400 x 2,000            = 8,00,000
    //   2. ceiling                           25,00,000
    //   3. ten months' salary  60,000 x 10  = 6,00,000   <- least
    //   4. 400 days / 30 x 60,000           = 8,00,000
    const r = calculateEncashmentExemption(
      input({ completedYears: d(20), daysEncashed: d(400), amountPaid: d(800000) }),
      config(),
    );

    expect(r.limitedBy).toBe('AVERAGE_SALARY_MONTHS');
    expect(r.exempt.toFixed(2)).toBe('600000.00');
    expect(r.taxable.toFixed(2)).toBe('200000.00');
    expect(r.limbs.leaveDaysPerYear.toFixed(2)).toBe('800000.00');
  });

  it('is limited by the lifetime ceiling for a well paid leaver', () => {
    // Average salary 4,00,000 a month, so a statutory day is 13,333.3333.
    //
    //   1. received  300 x 13,333.3333      = 40,00,000
    //   2. ceiling                            25,00,000   <- least
    //   3. ten months' salary  4,00,000 x 10 = 40,00,000
    //   4. 300 days (of 750 permitted) / 30 x 4,00,000 = 40,00,000
    const r = calculateEncashmentExemption(
      input({
        amountPaid: d(4000000),
        averageMonthlySalary: d(400000),
        completedYears: d(25),
        daysEncashed: d(300),
      }),
      config(),
    );

    expect(r.limitedBy).toBe('STATUTORY_CAP');
    expect(r.exempt.toFixed(2)).toBe('2500000.00');
    expect(r.taxable.toFixed(2)).toBe('1500000.00');
  });

  it('is limited by what was actually paid when the employer values a day below a statutory one', () => {
    // The employer treats a month as 40 days, so pays 1,500 for a day the
    // section values at 2,000. Nothing more than the 30,000 handed over can be
    // exempt, however generous the other three limbs are.
    //
    //   1. received                           30,000   <- least
    //   2. ceiling                         25,00,000
    //   3. ten months' salary               6,00,000
    //   4. 20 days (of 240 permitted) / 30 x 60,000 = 40,000
    const r = calculateEncashmentExemption(
      input({ amountPaid: d(30000), completedYears: d(8), daysEncashed: d(20) }),
      config(),
    );

    expect(r.limitedBy).toBe('AMOUNT_PAID');
    expect(r.exempt.toFixed(2)).toBe('30000.00');
    expect(r.taxable.toFixed(2)).toBe('0.00');
    expect(r.limbs.leaveDaysPerYear.toFixed(2)).toBe('40000.00');
  });
});

describe('calculateEncashmentExemption: the lifetime ceiling', () => {
  it('gives only the balance of the ceiling when part was used at an earlier employer', () => {
    // 25,00,000 less the 10,00,000 already exempted elsewhere leaves 15,00,000.
    // Of the 40,00,000 received, 25,00,000 is then taxable.
    const r = calculateEncashmentExemption(
      input({
        amountPaid: d(4000000),
        averageMonthlySalary: d(400000),
        completedYears: d(25),
        daysEncashed: d(300),
        exemptionAlreadyUsed: d(1000000),
      }),
      config(),
    );

    expect(r.limitedBy).toBe('STATUTORY_CAP');
    expect(r.limbs.statutoryCapRemaining.toFixed(2)).toBe('1500000.00');
    expect(r.exempt.toFixed(2)).toBe('1500000.00');
    expect(r.taxable.toFixed(2)).toBe('2500000.00');
  });

  it('exempts nothing when the ceiling was used up at an earlier employer', () => {
    const r = calculateEncashmentExemption(
      input({ exemptionAlreadyUsed: d(2500000) }),
      config(),
    );

    expect(r.limitedBy).toBe('STATUTORY_CAP');
    expect(r.limbs.statutoryCapRemaining.toFixed(2)).toBe('0.00');
    expect(r.exempt.toFixed(2)).toBe('0.00');
    // The whole 4,00,000 received is taxable as salary.
    expect(r.taxable.toFixed(2)).toBe('400000.00');
  });

  it('floors the remaining ceiling at zero rather than going negative', () => {
    // A ceiling raised since the earlier exemption was granted, or a bad figure
    // keyed in, must not turn into a negative limb and drag the minimum below
    // zero.
    const r = calculateEncashmentExemption(
      input({ exemptionAlreadyUsed: d(9999999) }),
      config(),
    );

    expect(r.limbs.statutoryCapRemaining.toFixed(2)).toBe('0.00');
    expect(r.exempt.toFixed(2)).toBe('0.00');
    expect(r.taxable.toFixed(2)).toBe('400000.00');
  });
});

describe('calculateEncashmentExemption: government employment', () => {
  it('exempts the whole encashment paid by a government employer', () => {
    const r = calculateEncashmentExemption(
      input({
        amountPaid: d(4000000),
        averageMonthlySalary: d(400000),
        completedYears: d(25),
        daysEncashed: d(300),
      }),
      config({ governmentEmployer: true }),
    );

    expect(r.limitedBy).toBe('GOVERNMENT_EMPLOYER');
    expect(r.exempt.toFixed(2)).toBe('4000000.00');
    expect(r.taxable.toFixed(2)).toBe('0.00');
  });

  it('reports every limb at the amount paid, none of them binding a government employee', () => {
    // The ceiling, the ten months and the 30 days a year are all limits on a
    // non-government employee. Showing what they *would* have been would invite
    // the reader to wonder why the exemption exceeds them.
    const r = calculateEncashmentExemption(
      input({ amountPaid: d(4000000) }),
      config({ governmentEmployer: true }),
    );

    expect(r.limbs.amountPaid.toFixed(2)).toBe('4000000.00');
    expect(r.limbs.statutoryCapRemaining.toFixed(2)).toBe('4000000.00');
    expect(r.limbs.averageSalaryMonths.toFixed(2)).toBe('4000000.00');
    expect(r.limbs.leaveDaysPerYear.toFixed(2)).toBe('4000000.00');
  });
});

describe('calculateEncashmentExemption: edges', () => {
  it('exempts nothing when no year of service has been completed', () => {
    // 30 days a year of nothing is nothing, whatever leave the employer's own
    // rules credited in the first year.
    const r = calculateEncashmentExemption(
      input({ completedYears: d(0), daysEncashed: d(10), amountPaid: d(20000) }),
      config(),
    );

    expect(r.limitedBy).toBe('LEAVE_DAYS_PER_YEAR');
    expect(r.limbs.leaveDaysPerYear.toFixed(2)).toBe('0.00');
    expect(r.exempt.toFixed(2)).toBe('0.00');
    expect(r.taxable.toFixed(2)).toBe('20000.00');
  });

  it('returns zeros when there is no leave to encash', () => {
    const r = calculateEncashmentExemption(
      input({ daysEncashed: d(0), amountPaid: d(0) }),
      config(),
    );

    expect(r.limitedBy).toBe('AMOUNT_PAID');
    expect(r.exempt.toFixed(2)).toBe('0.00');
    expect(r.taxable.toFixed(2)).toBe('0.00');
  });

  it('names the amount paid when it ties with another limb, because nothing is taxable', () => {
    // The employer values a day at exactly a statutory one, so limbs 1 and 4
    // agree. The useful thing to tell the leaver is that the whole encashment
    // is exempt, not that a limit they never reached was the reason.
    const r = calculateEncashmentExemption(
      input({ amountPaid: d(40000), completedYears: d(8), daysEncashed: d(20) }),
      config(),
    );

    expect(r.limbs.amountPaid.toFixed(2)).toBe('40000.00');
    expect(r.limbs.leaveDaysPerYear.toFixed(2)).toBe('40000.00');
    expect(r.limitedBy).toBe('AMOUNT_PAID');
    expect(r.taxable.toFixed(2)).toBe('0.00');
  });

  it('rounds a limb to paise, half up', () => {
    // 47 days at 55,000 a month: 47 x 55,000 / 30 = 86,166.6666..., which is
    // 86,166.67 to the paise. The 1,00,000 paid leaves 13,833.33 taxable.
    const r = calculateEncashmentExemption(
      input({
        amountPaid: d(100000),
        averageMonthlySalary: d(55000),
        completedYears: d(10),
        daysEncashed: d(47),
      }),
      config(),
    );

    expect(r.limitedBy).toBe('LEAVE_DAYS_PER_YEAR');
    expect(r.limbs.leaveDaysPerYear.toFixed(2)).toBe('86166.67');
    expect(r.exempt.toFixed(2)).toBe('86166.67');
    expect(r.taxable.toFixed(2)).toBe('13833.33');
  });

  it('never reports a negative taxable amount', () => {
    // An employer paying less than a statutory day for every day encashed:
    // limb 1 binds and the balance is nil, not a negative figure.
    const r = calculateEncashmentExemption(
      input({ amountPaid: d(1), completedYears: d(30), daysEncashed: d(1) }),
      config(),
    );

    expect(r.exempt.toFixed(2)).toBe('1.00');
    expect(r.taxable.toFixed(2)).toBe('0.00');
  });

  it('treats a nonsensical negative payment as nothing paid', () => {
    const r = calculateEncashmentExemption(
      input({ amountPaid: d(-5000) }),
      config(),
    );

    expect(r.limitedBy).toBe('AMOUNT_PAID');
    expect(r.limbs.amountPaid.toFixed(2)).toBe('0.00');
    expect(r.exempt.toFixed(2)).toBe('0.00');
    expect(r.taxable.toFixed(2)).toBe('0.00');
  });

  it('honours a configuration that departs from the statutory 30 and 10', () => {
    // Nothing is hard-coded: a tenant holding different figures gets them.
    // 45 days a year x 3 years = 135 days, so all 100 encashed qualify.
    // 100 / 45 = 2.2222 months x 60,000 = 1,33,333.33.
    const r = calculateEncashmentExemption(
      input({ amountPaid: d(200000), completedYears: d(3), daysEncashed: d(100) }),
      config({ exemptDaysPerYear: d(45), exemptMonths: d(6) }),
    );

    expect(r.limbs.averageSalaryMonths.toFixed(2)).toBe('360000.00');
    expect(r.limbs.leaveDaysPerYear.toFixed(2)).toBe('133333.33');
    expect(r.limitedBy).toBe('LEAVE_DAYS_PER_YEAR');
    expect(r.exempt.toFixed(2)).toBe('133333.33');
  });
});
