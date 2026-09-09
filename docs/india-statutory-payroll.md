# Indian statutory payroll

Provident fund, state insurance, professional tax, labour welfare fund and TDS.

> **Verify the numbers before you pay anyone.** The seeded rates and slabs are
> those for FY 2025-26 as understood when this was written. Rates change, states
> revise professional tax schedules, and the Finance Act moves the income tax
> slabs most years. Have whoever signs off your returns check every figure. This
> implements the common cases of each statute; it is not a substitute for
> professional advice, and the gaps are listed at the end.

## How it is put together

Rates, thresholds and slabs are **data, not code**. When a rate changes you edit
rows, not source. Four tables hold the configuration:

| Table | Holds |
|---|---|
| `statutory_configs` | One row per tenant: which levies apply and at what rates |
| `professional_tax_slabs` | State slab tables |
| `income_tax_configs` / `income_tax_slabs` | Slabs and parameters per financial year and regime |
| `employee_tax_declarations` | What each employee declared for the year |

The calculations themselves live in `statutory.calculators.ts` as pure
functions with no database or clock, so they can be read and tested against a
worked example on paper.

**Nothing is deducted until you opt in.** With no `statutory_configs` row for a
tenant, every statutory figure is zero and payroll behaves exactly as it did
before this feature existed.

## Setting it up

```bash
# 1. Apply the migration
cd backend && npx prisma migrate deploy

# 2. Seed the rates and slabs for your tenant and state
IMPORT_TENANT_ID=<tenant id> PT_STATE=Karnataka npm run prisma:seed-statutory
```

Professional tax slabs ship for Karnataka, Maharashtra, West Bengal, Telangana,
Andhra Pradesh, Gujarat and Madhya Pradesh. `PT_STATE` picks which one applies;
all are seeded so you can switch without re-running.

Then fill in what the seed cannot know:

- **Employee identifiers.** PAN, UAN, ESI number and bank details are new
  nullable columns on `employees`. PF and ESI returns cannot be filed without
  them. Set `pfOptOut` for excluded employees.
- **Which salary components count as PF wages.** Provident fund is computed on
  basic plus dearness allowance, not gross. Basic is always included; mark any
  other component with `"pfApplicable": true` in the salary structure. An
  unmarked allowance such as HRA is correctly left out.
- **Tax declarations.** Employees record theirs at `PUT /api/payroll/statutory/my-declaration`.
  Without one, TDS is computed on salary alone with only the standard deduction.

## What each levy does

**Provident fund.** Employee and employer both contribute 12% of PF wages. The
employer's share is not additional to the pension scheme: EPS is carved out of
it at 8.33%, always on wages capped at ₹15,000 even where the employer has
chosen to contribute on full wages, because that cap is statutory rather than a
matter of policy. EDLI and administration charges are computed as employer
costs. Contributions round to the nearest rupee.

Administration charges are returned per employee at the plain percentage. The
establishment-level monthly minimum is a property of the establishment, not of
any one employee, so apply it when preparing the ECR.

**State insurance.** 0.75% employee and 3.25% employer on gross, for anyone
earning at or below ₹21,000 a month, each share rounded up to the next rupee.
Crossing the wage limit mid-period does not end coverage: an employee who
contributed earlier in a contribution period (April to September, or October to
March) keeps contributing until it ends, and that is handled automatically by
looking at earlier payslips.

**Professional tax.** A state levy, taken from the slab table for the configured
state. Two common wrinkles are modelled: Maharashtra charges a different figure
in February, and some states set a higher exemption threshold for women.

**Labour welfare fund.** Fixed employee and employer amounts, deducted only in
the months the state collects, which for most states is not monthly.

**TDS.** The year's liability is projected from what has actually been earned so
far plus the current month repeated across the months remaining, which tracks a
mid-year raise better than multiplying by twelve. Slabs, standard deduction,
section 87A rebate, surcharge and cess all come from the configured year and
regime. The balance still owing is spread over the months left, as section 192
requires. Tax deducted by a previous employer is credited if declared.

Regimes differ in what may be deducted. Under the new regime only the standard
deduction and the employer's NPS contribution under section 80CCD(2) apply;
chapter VI-A deductions, HRA exemption, home loan interest and the professional
tax deduction under section 16(iii) do not. An employee's own choice on their
record wins, then their declaration, then the tenant default.

## What is on the payslip

Statutory amounts are stored as columns on `payslips` rather than only inside
the deductions JSON, because returns and reconciliations query them directly:
`pfWages`, `pfEmployee`, `pfEmployer`, `epsEmployer`, `edliEmployer`,
`pfAdminEmployer`, `esiWages`, `esiEmployee`, `esiEmployer`, `professionalTax`,
`lwfEmployee`, `lwfEmployer` and `tds`. `taxComputation` holds how the TDS
figure was arrived at, so it can be explained to an employee who asks.

## Not implemented

Known and deliberate, so nobody assumes otherwise:

- **Return and challan files.** No PF ECR, ESI return, PT challan or 24Q. The
  figures are all present to build them from; the file writers are not.
- **Form 16.** No Part A or Part B generation.
- **Investment proof workflow.** Declarations are taken at face value. Nothing
  collects, verifies or approves evidence, and no limit is enforced on a
  declared amount, so section 80C above ₹1,50,000 will be accepted as declared.
  Validate before it reaches payroll.
- **Marginal relief on surcharge.** Surcharge is applied at the flat slab rate.
  For income just above a threshold this overstates the liability.
- **Senior citizen exemptions.** The old regime uses the basic exemption for an
  individual below 60.
- **Gratuity and full and final settlement.** Still absent, as before.
- **Half-yearly professional tax states.** Tamil Nadu and others that levy
  half-yearly are not modelled; configure a monthly equivalent or leave the levy
  off for those states.
- **Retrospective recalculation.** Changing a rate affects the next run. Runs
  already computed are not recalculated.
