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
import { PrismaClient, TaxRegime, TaxAgeBand } from '@prisma/client';

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

// None of the states above are seeded with `ptMonths`: every one of them
// collects professional tax monthly (confirmed against each state's own Act
// / rules), so leaving `ptMonths` at its schema default of `[]` ("every
// month") is the correct, not merely the lazy, choice for all seven. See the
// bottom of this file for why Tamil Nadu (the well-known half-yearly state)
// is deliberately NOT added here.

/** Income tax parameters for FY 2025-26 (assessment year 2026-27). */
const FINANCIAL_YEAR = 2025;

const SURCHARGE_COMMON = [
  { threshold: 5000000, rate: 10 },
  { threshold: 10000000, rate: 15 },
  { threshold: 20000000, rate: 25 },
];

/**
 * Chapter VI-A ceilings, FY 2025-26.
 *
 * - Section 80C (aggregate of 80C/80CCC/80CCD(1), capped in aggregate under
 *   section 80CCE): Rs 1,50,000. Unchanged since FY 2014-15 (Finance Act
 *   2014) and does not vary by the taxpayer's age.
 * - Section 80D (medical insurance premium): Rs 25,000 for a non-senior
 *   taxpayer, Rs 50,000 where the taxpayer is a senior citizen (60+) per
 *   section 80D(2)(b) — the higher figure applies to both SENIOR and
 *   SUPER_SENIOR bands here.
 * - Section 80CCD(1B) (additional NPS contribution, over and above 80C):
 *   Rs 50,000. In force since FY 2015-16 (Finance Act 2015) and does not
 *   vary by age.
 *
 * These three deductions are Chapter VI-A deductions and are only available
 * under the OLD regime. Section 115BAC(2)(i), which governs the new regime,
 * withdraws them (along with most other Chapter VI-A deductions) for anyone
 * who opts in — the new regime instead keeps the standard deduction and
 * section 80CCD(2) (employer NPS contribution, not modelled by these three
 * fields). The NEW-regime config below therefore seeds all three ceilings as
 * zero rather than reusing the OLD-regime figures, so a declaration entered
 * against the new regime cannot silently claim a deduction the regime does
 * not allow.
 */
const CHAPTER_VI_A_OLD = {
  section80CLimit: 150000,
  section80CCD1BLimit: 50000,
};
const SECTION_80D_OLD: Record<TaxAgeBand, number> = {
  GENERAL: 25000,
  SENIOR: 50000,
  SUPER_SENIOR: 50000,
};
const CHAPTER_VI_A_NEW_REGIME_DISALLOWED = {
  section80CLimit: 0,
  section80DLimit: 0,
  section80CCD1BLimit: 0,
};

/**
 * Marginal relief on surcharge (the surcharge cannot push post-surcharge tax
 * above pre-surcharge tax plus the amount of income over the threshold).
 * This is a general provision of the Finance Act, applies identically to
 * both regimes, and does not vary by age band.
 */
const MARGINAL_RELIEF_ENABLED = true;

const INCOME_TAX = {
  // The new regime (section 115BAC) uses one basic-exemption schedule for
  // every individual regardless of age — the age-based higher exemption is
  // an old-regime-only concession (see the OLD block below). So only
  // GENERAL is seeded here; seeding SENIOR and SUPER_SENIOR with identical
  // numbers would just be three copies of the same row with no informational
  // value and a bigger chance of the copies drifting out of sync on a future
  // rate change.
  NEW: [
    {
      ageBand: TaxAgeBand.GENERAL,
      standardDeduction: 75000,
      rebateIncomeLimit: 1200000,
      rebateMaxAmount: 60000,
      cessRate: 4,
      // The new regime caps surcharge at 25%.
      surchargeSlabs: SURCHARGE_COMMON,
      ...CHAPTER_VI_A_NEW_REGIME_DISALLOWED,
      // Finance Act 2025 slabs (Budget 2025), effective FY 2025-26.
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
  ],
  // Old-regime slabs have been unchanged since Finance Act 2014 (FY 2014-15)
  // through FY 2025-26 — every Finance Act since has revised the new-regime
  // schedule while leaving the old regime as-is. The three age bands below
  // are Part I, Paragraph A of the relevant Finance Act's First Schedule for
  // (a) an individual below 60, (b) a resident individual of 60 up to (but
  // not including) 80 — "senior citizen", and (c) a resident individual of
  // 80 or above — "super senior citizen".
  OLD: [
    {
      ageBand: TaxAgeBand.GENERAL,
      standardDeduction: 50000,
      rebateIncomeLimit: 500000,
      rebateMaxAmount: 12500,
      cessRate: 4,
      surchargeSlabs: [...SURCHARGE_COMMON, { threshold: 50000000, rate: 37 }],
      section80DLimit: SECTION_80D_OLD.GENERAL,
      ...CHAPTER_VI_A_OLD,
      slabs: [
        { from: 0, to: 250000, rate: 0 },
        { from: 250000, to: 500000, rate: 5 },
        { from: 500000, to: 1000000, rate: 20 },
        { from: 1000000, to: null, rate: 30 },
      ],
    },
    {
      ageBand: TaxAgeBand.SENIOR,
      standardDeduction: 50000,
      rebateIncomeLimit: 500000,
      rebateMaxAmount: 12500,
      cessRate: 4,
      surchargeSlabs: [...SURCHARGE_COMMON, { threshold: 50000000, rate: 37 }],
      section80DLimit: SECTION_80D_OLD.SENIOR,
      ...CHAPTER_VI_A_OLD,
      slabs: [
        { from: 0, to: 300000, rate: 0 },
        { from: 300000, to: 500000, rate: 5 },
        { from: 500000, to: 1000000, rate: 20 },
        { from: 1000000, to: null, rate: 30 },
      ],
    },
    {
      ageBand: TaxAgeBand.SUPER_SENIOR,
      standardDeduction: 50000,
      rebateIncomeLimit: 500000,
      rebateMaxAmount: 12500,
      cessRate: 4,
      surchargeSlabs: [...SURCHARGE_COMMON, { threshold: 50000000, rate: 37 }],
      section80DLimit: SECTION_80D_OLD.SUPER_SENIOR,
      ...CHAPTER_VI_A_OLD,
      slabs: [
        { from: 0, to: 500000, rate: 0 },
        { from: 500000, to: 1000000, rate: 20 },
        { from: 1000000, to: null, rate: 30 },
      ],
    },
  ],
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

  // `ptMonths` is deliberately left untouched here (create relies on the
  // schema default of `[]`, update does not mention it), so a re-run cannot
  // change collection months for a tenant that already has some configured,
  // and a brand-new tenant gets "every month" — the same behaviour as before
  // the column existed.
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
    const bands = INCOME_TAX[regime];
    // Deleting the config cascades to its slabs. Scoped to tenant + year +
    // regime only (not ageBand), so this clears every age band's row for
    // the regime before recreating them — safe under the new
    // (tenantId, financialYear, regime, ageBand) unique key on a re-run.
    await prisma.incomeTaxConfig.deleteMany({
      where: { tenantId, financialYear: FINANCIAL_YEAR, regime: regime as TaxRegime },
    });
    for (const cfg of bands) {
      await prisma.incomeTaxConfig.create({
        data: {
          tenantId,
          financialYear: FINANCIAL_YEAR,
          regime: regime as TaxRegime,
          ageBand: cfg.ageBand,
          standardDeduction: cfg.standardDeduction,
          rebateIncomeLimit: cfg.rebateIncomeLimit,
          rebateMaxAmount: cfg.rebateMaxAmount,
          cessRate: cfg.cessRate,
          surchargeSlabs: cfg.surchargeSlabs,
          section80CLimit: cfg.section80CLimit,
          section80DLimit: cfg.section80DLimit,
          section80CCD1BLimit: cfg.section80CCD1BLimit,
          marginalReliefEnabled: MARGINAL_RELIEF_ENABLED,
          slabs: {
            create: cfg.slabs.map((s) => ({
              fromAmount: s.from,
              toAmount: s.to,
              rate: s.rate,
            })),
          },
        },
      });
    }
    console.log(
      `  income tax: FY ${FINANCIAL_YEAR}-${(FINANCIAL_YEAR + 1) % 100} ${regime} regime seeded ` +
        `(${bands.map((b) => b.ageBand).join(', ')})`,
    );
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

/**
 * ---------------------------------------------------------------------------
 * Deliberately NOT seeded — hand these to a payroll professional:
 *
 * 1. Tamil Nadu professional tax (and any other half-yearly state, e.g.
 *    Tripura). `StatutoryConfig.ptMonths` exists in the schema, but
 *    `calculateProfessionalTax` in statutory.calculators.ts does not
 *    currently consult it at all — its own doc comment says half-yearly
 *    states are "not modelled; configure those as a monthly equivalent or
 *    leave the levy off." Until that function is wired to read `ptMonths`
 *    (tracked as in-flight work elsewhere in this codebase, outside this
 *    seed script's ownership), I don't know whether the intended semantics
 *    are "deduct the full half-yearly amount only in the listed month(s)"
 *    or something else, so encoding Tamil Nadu's real half-yearly slabs
 *    (which are published in half-yearly rupee amounts, not monthly ones)
 *    against an unconfirmed consumer would risk a wrong deduction. Add it
 *    once the calculator's `ptMonths` behaviour is confirmed.
 * 2. Every professional tax slab revision more recent than what's already
 *    in PROFESSIONAL_TAX above for the seven states already shipped — I did
 *    not re-verify those against current notifications, only confirmed they
 *    are each collected monthly (so no `ptMonths` entry is needed for any
 *    of them).
 * 3. Any financial year other than FY 2025-26. A future year's Finance Act
 *    slabs, once passed, should be added as a new set of rows (this script
 *    keys on FINANCIAL_YEAR), never by editing these numbers in place.
 * ---------------------------------------------------------------------------
 */
