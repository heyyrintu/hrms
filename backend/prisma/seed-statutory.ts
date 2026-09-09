/**
 * Seeds the Indian statutory payroll configuration for one tenant.
 *
 * ---------------------------------------------------------------------------
 * VERIFY BEFORE USE.
 *
 * The figures below are the rates and slabs for FY 2025-26 as understood at
 * the time of writing. Rates change, states revise their professional tax
 * schedules, and the Finance Act moves the income tax slabs most years. Check
 * every number against the current notification with whoever signs off your
 * returns before you run a real payroll on them.
 *
 * Nothing here is hardcoded into the application: these are rows, and the
 * intended way to handle a rate change is to edit the data, not the source.
 * ---------------------------------------------------------------------------
 *
 * Idempotent: safe to re-run. Existing rows for the tenant are replaced.
 *
 *   IMPORT_TENANT_ID=<tenant id> npm run prisma:seed-statutory
 */
import { PrismaClient, TaxRegime } from '@prisma/client';

const prisma = new PrismaClient();

/** Monthly professional tax slabs, by state. */
const PROFESSIONAL_TAX: Record<
  string,
  { from: number; to: number | null; amount: number; february?: number; gender?: string }[]
> = {
  Karnataka: [
    { from: 0, to: 24999.99, amount: 0 },
    { from: 25000, to: null, amount: 200 },
  ],
  Maharashtra: [
    // Maharashtra exempts women up to a higher threshold and collects the
    // year's balance in February.
    { from: 0, to: 25000, amount: 0, gender: 'Female' },
    { from: 25000.01, to: null, amount: 200, february: 300, gender: 'Female' },
    { from: 0, to: 7500, amount: 0, gender: 'Male' },
    { from: 7500.01, to: 10000, amount: 175, gender: 'Male' },
    { from: 10000.01, to: null, amount: 200, february: 300, gender: 'Male' },
  ],
  'West Bengal': [
    { from: 0, to: 10000, amount: 0 },
    { from: 10000.01, to: 15000, amount: 110 },
    { from: 15000.01, to: 25000, amount: 130 },
    { from: 25000.01, to: 40000, amount: 150 },
    { from: 40000.01, to: null, amount: 200 },
  ],
  Telangana: [
    { from: 0, to: 15000, amount: 0 },
    { from: 15000.01, to: 20000, amount: 150 },
    { from: 20000.01, to: null, amount: 200 },
  ],
  'Andhra Pradesh': [
    { from: 0, to: 15000, amount: 0 },
    { from: 15000.01, to: 20000, amount: 150 },
    { from: 20000.01, to: null, amount: 200 },
  ],
  Gujarat: [
    { from: 0, to: 12000, amount: 0 },
    { from: 12000.01, to: null, amount: 200 },
  ],
  'Madhya Pradesh': [
    { from: 0, to: 18750, amount: 0 },
    { from: 18750.01, to: 25000, amount: 125 },
    { from: 25000.01, to: 33333, amount: 167 },
    { from: 33333.01, to: null, amount: 208, february: 212 },
  ],
};

/** Income tax parameters for FY 2025-26 (assessment year 2026-27). */
const FINANCIAL_YEAR = 2025;

const SURCHARGE_COMMON = [
  { threshold: 5000000, rate: 10 },
  { threshold: 10000000, rate: 15 },
  { threshold: 20000000, rate: 25 },
];

const INCOME_TAX = {
  NEW: {
    standardDeduction: 75000,
    rebateIncomeLimit: 1200000,
    rebateMaxAmount: 60000,
    cessRate: 4,
    // The new regime caps surcharge at 25%.
    surchargeSlabs: SURCHARGE_COMMON,
    slabs: [
      { from: 0, to: 400000, rate: 0 },
      { from: 400000, to: 800000, rate: 5 },
      { from: 800000, to: 1200000, rate: 10 },
      { from: 1200000, to: 1600000, rate: 15 },
      { from: 1600000, to: 2000000, rate: 20 },
      { from: 2000000, to: 2400000, rate: 25 },
      { from: 2400000, to: null, rate: 30 },
    ],
  },
  OLD: {
    standardDeduction: 50000,
    rebateIncomeLimit: 500000,
    rebateMaxAmount: 12500,
    cessRate: 4,
    surchargeSlabs: [...SURCHARGE_COMMON, { threshold: 50000000, rate: 37 }],
    slabs: [
      // Basic exemption for an individual below 60. The higher exemptions for
      // senior and very senior citizens are not modelled.
      { from: 0, to: 250000, rate: 0 },
      { from: 250000, to: 500000, rate: 5 },
      { from: 500000, to: 1000000, rate: 20 },
      { from: 1000000, to: null, rate: 30 },
    ],
  },
};

async function main() {
  const tenantId = process.env.IMPORT_TENANT_ID;
  if (!tenantId) {
    console.error('Set IMPORT_TENANT_ID to the tenant you want to configure.');
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.error(`No tenant with id ${tenantId}.`);
    process.exit(1);
  }

  const state = process.env.PT_STATE ?? 'Karnataka';
  if (!PROFESSIONAL_TAX[state]) {
    console.error(
      `No professional tax slabs for "${state}". Known states: ${Object.keys(PROFESSIONAL_TAX).join(', ')}.`,
    );
    process.exit(1);
  }

  console.log(`Configuring statutory payroll for ${tenant.name} (professional tax: ${state})`);

  await prisma.statutoryConfig.upsert({
    where: { tenantId },
    update: { ptState: state },
    create: { tenantId, ptState: state },
  });

  // Replace the slab tables wholesale so a re-run cannot leave stale rows
  // behind alongside the new ones.
  await prisma.professionalTaxSlab.deleteMany({ where: { tenantId } });
  for (const [slabState, slabs] of Object.entries(PROFESSIONAL_TAX)) {
    for (const s of slabs) {
      await prisma.professionalTaxSlab.create({
        data: {
          tenantId,
          state: slabState,
          fromAmount: s.from,
          toAmount: s.to,
          amount: s.amount,
          februaryAmount: s.february ?? null,
          gender: s.gender ?? null,
        },
      });
    }
  }
  console.log(`  professional tax: ${Object.keys(PROFESSIONAL_TAX).length} states seeded`);

  for (const regime of ['NEW', 'OLD'] as const) {
    const cfg = INCOME_TAX[regime];
    // Deleting the config cascades to its slabs.
    await prisma.incomeTaxConfig.deleteMany({
      where: { tenantId, financialYear: FINANCIAL_YEAR, regime: regime as TaxRegime },
    });
    await prisma.incomeTaxConfig.create({
      data: {
        tenantId,
        financialYear: FINANCIAL_YEAR,
        regime: regime as TaxRegime,
        standardDeduction: cfg.standardDeduction,
        rebateIncomeLimit: cfg.rebateIncomeLimit,
        rebateMaxAmount: cfg.rebateMaxAmount,
        cessRate: cfg.cessRate,
        surchargeSlabs: cfg.surchargeSlabs,
        slabs: {
          create: cfg.slabs.map((s) => ({
            fromAmount: s.from,
            toAmount: s.to,
            rate: s.rate,
          })),
        },
      },
    });
    console.log(`  income tax: FY ${FINANCIAL_YEAR}-${(FINANCIAL_YEAR + 1) % 100} ${regime} regime seeded`);
  }

  console.log(
    '\nDone. Verify every rate against the current notification before running a real payroll.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
