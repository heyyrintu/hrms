import { Decimal } from '@prisma/client/runtime/library';
import { calculateGratuity } from './gratuity.calculator';
import type { GratuityConfig, GratuityInput } from './gratuity.types';

const d = (n: number | string) => new Decimal(n);

/** UTC noon, so no timezone can shift the calendar day out from under a test. */
const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

const config: GratuityConfig = {
  gratuityEnabled: true,
  gratuityDaysPerYear: d(15),
  gratuityMonthDays: d(26),
  gratuityMinYears: d(5),
  gratuityExemptionCap: d(2000000),
};

/**
 * 52,000 a month is chosen throughout because it divides cleanly:
 * 52,000 x 15 / 26 = 30,000 of gratuity per counted year.
 */
const input = (over: Partial<GratuityInput> = {}): GratuityInput => ({
  lastDrawnWages: d(52000),
  joinDate: on('2019-04-01'),
  lastWorkingDate: on('2024-03-31'),
  ...over,
});

describe('calculateGratuity: counting the service', () => {
  it('treats joining on 1 April 2019 and last working on 31 March 2024 as exactly five years', () => {
    // The last working day is served, so the period is inclusive at both ends:
    // 01-04-2019 to 31-03-2024 is 60 completed months, not 59 months 30 days.
    const r = calculateGratuity(input(), config);

    expect(r.eligible).toBe(true);
    expect(r.ineligibleReason).toBeNull();
    expect(r.serviceYears.toString()).toBe('5');
    expect(r.countedYears.toString()).toBe('5');
    // 52,000 x 15 / 26 = 30,000 per year; 30,000 x 5 = 1,50,000
    expect(r.amount.toString()).toBe('150000');
  });

  it('rounds five years and seven months up to six counted years', () => {
    // 01-04-2019 to 31-10-2024 is 67 completed months: 5 years 7 months.
    // 7 months is in excess of six, so the part-year rounds up.
    const r = calculateGratuity(
      input({ lastWorkingDate: on('2024-10-31') }),
      config,
    );

    expect(r.eligible).toBe(true);
    expect(r.serviceYears.toString()).toBe('5.5833'); // 67 / 12
    expect(r.countedYears.toString()).toBe('6');
    // 30,000 x 6 = 1,80,000
    expect(r.amount.toString()).toBe('180000');
  });

  it('drops a part-year of exactly six months', () => {
    // 01-04-2019 to 30-09-2024 is 66 completed months: 5 years 6 months, and
    // six months is not "in excess of six months", so it is dropped.
    const r = calculateGratuity(
      input({ lastWorkingDate: on('2024-09-30') }),
      config,
    );

    expect(r.eligible).toBe(true);
    expect(r.serviceYears.toString()).toBe('5.5'); // 66 / 12
    expect(r.countedYears.toString()).toBe('5');
    expect(r.amount.toString()).toBe('150000');
  });

  it('rounds up on six months and one day', () => {
    // 01-04-2019 to 01-10-2024 is 5 years, 6 months and 1 day, which is in
    // excess of six months by exactly the margin the Act cares about.
    const r = calculateGratuity(
      input({ lastWorkingDate: on('2024-10-01') }),
      config,
    );

    expect(r.countedYears.toString()).toBe('6');
    expect(r.amount.toString()).toBe('180000');
  });
});

describe('calculateGratuity: mid-month dates', () => {
  it('completes five years on the day before the fifth anniversary of joining', () => {
    // Joined 15-04-2019, last worked 14-04-2024: the anniversary day itself is
    // the first day of year six, so serving the day before completes five.
    const r = calculateGratuity(
      input({ joinDate: on('2019-04-15'), lastWorkingDate: on('2024-04-14') }),
      config,
    );

    expect(r.eligible).toBe(true);
    expect(r.serviceYears.toString()).toBe('5');
    expect(r.countedYears.toString()).toBe('5');
    expect(r.amount.toString()).toBe('150000');
  });

  it('refuses service one day short of five years', () => {
    // Joined 15-04-2019, last worked 13-04-2024: 4 years, 11 months and 30
    // days, borrowing the 31 days of March to complete the last month.
    const r = calculateGratuity(
      input({ joinDate: on('2019-04-15'), lastWorkingDate: on('2024-04-13') }),
      config,
    );

    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toContain('Service of 4 years and 11 months');
    expect(r.serviceYears.toString()).toBe('4.9167'); // 59 / 12
    expect(r.amount.toString()).toBe('0');
  });

  it('completes five years from 29 February on 28 February, there being no leap day', () => {
    // Joined 29-02-2020. 2025 has no 29 February, so the fifth year is
    // completed by serving to 28-02-2025.
    const r = calculateGratuity(
      input({ joinDate: on('2020-02-29'), lastWorkingDate: on('2025-02-28') }),
      config,
    );

    expect(r.eligible).toBe(true);
    expect(r.serviceYears.toString()).toBe('5');
    expect(r.amount.toString()).toBe('150000');
  });
});

describe('calculateGratuity: the qualifying period', () => {
  it('refuses four years and eleven months, however close the rounding looks', () => {
    // 01-04-2019 to 29-02-2024 is 59 completed months. The part-year of 11
    // months would round up, but the qualifying period is tested on completed
    // years, of which there are four.
    const r = calculateGratuity(
      input({ lastWorkingDate: on('2024-02-29') }),
      config,
    );

    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe(
      'Service of 4 years and 11 months is short of the 5 completed years required. ' +
        'The qualifying period is waived only on death or permanent disablement.',
    );
    expect(r.serviceYears.toString()).toBe('4.9167'); // 59 / 12
    expect(r.countedYears.toString()).toBe('0');
    expect(r.amount.toString()).toBe('0');
    expect(r.exemptAmount.toString()).toBe('0');
    expect(r.taxableAmount.toString()).toBe('0');
  });

  it('pays on death after two years, because death waives the qualifying period', () => {
    // 01-04-2022 to 31-03-2024 is 24 completed months.
    const r = calculateGratuity(
      input({
        joinDate: on('2022-04-01'),
        lastWorkingDate: on('2024-03-31'),
        waiveMinimumService: true,
      }),
      config,
    );

    expect(r.eligible).toBe(true);
    expect(r.countedYears.toString()).toBe('2');
    // 30,000 x 2 = 60,000
    expect(r.amount.toString()).toBe('60000');
    expect(r.exemptAmount.toString()).toBe('60000');
    expect(r.taxableAmount.toString()).toBe('0');
  });

  it('still applies the part-year rounding when the qualifying period is waived', () => {
    // 01-04-2022 to 31-12-2024 is 33 months: 2 years 9 months, rounding to 3.
    const r = calculateGratuity(
      input({
        joinDate: on('2022-04-01'),
        lastWorkingDate: on('2024-12-31'),
        waiveMinimumService: true,
      }),
      config,
    );

    expect(r.countedYears.toString()).toBe('3');
    expect(r.amount.toString()).toBe('90000');
  });

  it('pays nothing when even a waived case has no countable year', () => {
    // 01-04-2023 to 30-06-2023 is 3 months, which rounds down to nothing.
    const r = calculateGratuity(
      input({
        joinDate: on('2023-04-01'),
        lastWorkingDate: on('2023-06-30'),
        waiveMinimumService: true,
      }),
      config,
    );

    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe(
      'Service of 0 years and 3 months does not amount to a single countable year.',
    );
    expect(r.countedYears.toString()).toBe('0');
    expect(r.amount.toString()).toBe('0');
  });

  it('writes the reason in the singular where the figure is one', () => {
    // 01-04-2022 to 30-06-2023 is 15 months: 1 year and 3 months.
    const short = calculateGratuity(
      input({ joinDate: on('2022-04-01'), lastWorkingDate: on('2023-06-30') }),
      config,
    );
    expect(short.ineligibleReason).toContain('Service of 1 year and 3 months');

    // 01-04-2023 to 01-05-2023 is 1 month and 1 day.
    const brief = calculateGratuity(
      input({
        joinDate: on('2023-04-01'),
        lastWorkingDate: on('2023-05-01'),
        waiveMinimumService: true,
      }),
      config,
    );
    expect(brief.ineligibleReason).toContain('Service of 0 years and 1 month');
  });
});

describe('calculateGratuity: the money', () => {
  it('rounds the payable amount to the nearest rupee', () => {
    // 50,000 x 15 / 26 = 28,846.153846...; x 5 = 1,44,230.769..., to 1,44,231
    const r = calculateGratuity(input({ lastDrawnWages: d(50000) }), config);

    expect(r.amount.toString()).toBe('144231');
    expect(r.exemptAmount.toString()).toBe('144231');
    expect(r.taxableAmount.toString()).toBe('0');
  });

  it('exempts only up to the section 10(10) ceiling on a large payout', () => {
    // 01-04-1994 to 31-03-2024 is 360 months: 30 years.
    // 2,60,000 x 15 / 26 = 1,50,000 a year; x 30 = 45,00,000.
    const r = calculateGratuity(
      input({
        lastDrawnWages: d(260000),
        joinDate: on('1994-04-01'),
        lastWorkingDate: on('2024-03-31'),
      }),
      config,
    );

    expect(r.countedYears.toString()).toBe('30');
    expect(r.amount.toString()).toBe('4500000');
    expect(r.exemptAmount.toString()).toBe('2000000');
    // 45,00,000 - 20,00,000 = 25,00,000 taxable as salary
    expect(r.taxableAmount.toString()).toBe('2500000');
  });

  it('exempts only the 15/26 figure when the employer pays on more generous terms', () => {
    // The employer counts 30 days a year rather than 15, so it pays double,
    // but section 10(10) still measures the exemption on 15/26.
    const r = calculateGratuity(input(), {
      ...config,
      gratuityDaysPerYear: d(30),
    });

    // 52,000 x 30 / 26 = 60,000 a year; x 5 = 3,00,000 paid
    expect(r.amount.toString()).toBe('300000');
    // 52,000 x 15 / 26 = 30,000 a year; x 5 = 1,50,000 exempt
    expect(r.exemptAmount.toString()).toBe('150000');
    expect(r.taxableAmount.toString()).toBe('150000');
  });

  it('never exempts more than is actually paid', () => {
    // A 30-day month divisor pays less than the statutory 26-day one, so the
    // exemption is capped by the payment rather than by the 15/26 figure.
    const r = calculateGratuity(input(), {
      ...config,
      gratuityMonthDays: d(30),
    });

    // 52,000 x 15 / 30 = 26,000 a year; x 5 = 1,30,000
    expect(r.amount.toString()).toBe('130000');
    expect(r.exemptAmount.toString()).toBe('130000');
    expect(r.taxableAmount.toString()).toBe('0');
  });
});

describe('calculateGratuity: refusals rather than throws', () => {
  it('returns a reason when the establishment has gratuity switched off', () => {
    const r = calculateGratuity(input(), { ...config, gratuityEnabled: false });

    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe(
      'Gratuity is not enabled for this establishment.',
    );
    expect(r.serviceYears.toString()).toBe('0');
    expect(r.countedYears.toString()).toBe('0');
    expect(r.amount.toString()).toBe('0');
    expect(r.exemptAmount.toString()).toBe('0');
    expect(r.taxableAmount.toString()).toBe('0');
  });

  it('returns a reason when the last working date precedes the join date', () => {
    const r = calculateGratuity(
      input({ joinDate: on('2024-03-31'), lastWorkingDate: on('2019-04-01') }),
      config,
    );

    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe(
      'The last working date is not on or after the join date, so no service is recorded.',
    );
    expect(r.serviceYears.toString()).toBe('0');
    expect(r.amount.toString()).toBe('0');
  });

  it('returns a reason when the last working date is the day before the join date', () => {
    // The tightest reversed pair: measuring to the day after the last working
    // day lands exactly on the join date, so nothing at all was served.
    const r = calculateGratuity(
      input({ joinDate: on('2024-04-01'), lastWorkingDate: on('2024-03-31') }),
      config,
    );

    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe(
      'The last working date is not on or after the join date, so no service is recorded.',
    );
    expect(r.serviceYears.toString()).toBe('0');
  });

  it('treats a single day served as service, though it counts no years', () => {
    // Joining and leaving on the same day is one day served, not zero, so the
    // refusal is about the countable year rather than about missing service.
    const r = calculateGratuity(
      input({
        joinDate: on('2024-04-01'),
        lastWorkingDate: on('2024-04-01'),
        waiveMinimumService: true,
      }),
      config,
    );

    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe(
      'Service of 0 years and 0 months does not amount to a single countable year.',
    );
    expect(r.amount.toString()).toBe('0');
  });

  it('returns a reason when no last drawn wages are recorded', () => {
    const r = calculateGratuity(input({ lastDrawnWages: d(0) }), config);

    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe(
      'No last drawn wages (basic plus dearness allowance) are recorded.',
    );
    expect(r.amount.toString()).toBe('0');
  });
});
