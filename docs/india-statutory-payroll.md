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

## Returns and challan files

Five files are generated from a completed payroll run, at
`GET /api/payroll/returns/:payrollRunId/...`:

| Route | Produces |
|---|---|
| `pf-ecr` | EPFO Electronic Challan cum Return, `#~#` delimited |
| `esi` | ESIC monthly contribution file |
| `professional-tax` | State professional tax challan working |
| `form-24q` | Quarterly TDS return working, section 92B |
| `bank-transfer` | Salary disbursement file for the bank |

A run still in draft is refused, because a return filed from figures that may
still change is worse than no return.

**Check every file against your own portal template before you upload it.** The
EPFO has revised the ECR layout more than once and the version here may not be
the one your establishment is on. The bank transfer file is a generic NEFT
layout; banks differ. The deductee section code on 24Q is fixed at 92B, which is
right for ordinary salary payments and wrong for a government employee.

## Form 16

Part B only, at `GET /api/payroll/form16/my/:financialYear` for an employee's
own certificate and `GET /api/payroll/form16/:employeeId/:financialYear` for
payroll staff, each with a `/quarters` working and a `/pdf` rendering.

**Part A cannot be produced here and is not attempted.** It is issued by TRACES
against the returns actually filed; a document imitating it would be a forgery.
Every response and every page of the PDF says so.

The liability comes from the same `calculateIncomeTax` the monthly TDS engine
uses, fed the year's actuals rather than a projection, so the certificate and
the payslips reconcile by construction. The quarterly figures are what payroll
deducted, not what was filed, and must be checked against the 24Q returns and
challans before anything is issued to an employee.

## Gratuity and full and final settlement

Gratuity follows the Payment of Gratuity Act 1972: fifteen days of last drawn
basic and dearness allowance for each completed year, on a twenty-six day month,
with a part-year above six months rounded up. Five years of service qualify,
waived on death or permanent disablement. The parameters are columns on
`statutory_configs`, not constants. Section 10(10) caps the tax exemption at
₹20,00,000; the amount payable itself is not capped, so an employer paying above
the statutory ceiling gets the figure they actually owe with the excess marked
taxable.

Settlements live at `/api/exit/settlements`, computed from a separation and held
as a draft until approved and paid. Status transitions are guarded in the
database, so two approvals racing each other cannot both win. A settlement
totals pro-rata salary, leave encashment, gratuity and other earnings against
notice shortfall recovery, other recoveries and TDS.

## The pages

| Page | Who | What it does |
|---|---|---|
| Payroll → Statutory Returns | HR admin | Pick a computed run, preview and download the five files |
| Payroll → Form 16 | HR admin | Any employee's Part B certificate and PDF |
| My Form 16 | Everyone | Your own Part B certificate and PDF |
| Settlements | HR admin | Full and final settlements, with the gratuity working |
| Admin → Statutory Payroll | HR admin | Rates, thresholds and which levies apply |
| Payroll → Tax Declarations | HR admin | Read what an employee declared |
| My Tax Declaration | Everyone | Record what you expect to claim this year |
| My Tax Proofs | Everyone | Submit evidence and see where each piece stands |
| Payroll → Proof Review | HR admin | Review evidence and record a decision |

Two things the pages do deliberately, which are easy to undo by accident.

**A return is previewed before it is downloaded.** The preview shows the
warnings, which name every employee left out of the file and why, usually a
missing UAN, ESI number or PAN. An employee missing from a statutory return is a
filing defect. The warnings are not collapsible, and a file with none says so
explicitly, so the user knows the check ran rather than assuming silence means
success.

**Nothing is presented as ready to file or ready to issue.** Each file carries
the caveat that applies to it, and the Form 16 pages say on every view that Part
A comes from TRACES and cannot be produced here. A user who downloads and
uploads without reading is the case these pages are designed against.

**A tenant with no configuration is shown as exactly that.** With no row,
nothing statutory comes off anyone's pay and payroll behaves as it did before
the feature existed. The page says so and offers to set it up, rather than
rendering a form full of zeros that would read as rates of nil. Choosing to set
it up fills the form with the rates in the Act but writes nothing until somebody
has checked the figures and saved.

**Slab tables are read-only in the interface**, because they are seeded per
state and financial year and there is no endpoint to edit one. Changing a slab
is a seed or a migration, not a form.

## Investment proofs

An employee files evidence against a head, payroll staff accept or refuse it,
and from a cutoff month the accepted amounts replace the declared ones in the
TDS calculation. That last part is the point: without it the approvals would be
decorative.

**It is off by default and must stay that way until somebody decides
otherwise.** `proofVerificationRequired` on `statutory_configs` starts false, so
an installation that does not opt in keeps taking declarations at face value
exactly as it did before proofs existed. Switching it on means a head with no
approved proof allows nothing, which raises the tax deducted from every employee
who has not submitted evidence. That is correct, and it is why it is a decision
rather than an upgrade.

`proofCutoffMonth` defaults to January. Employers accept declarations through
the year and call proofs in near its end, so before the cutoff the declaration
stands on its own. The month is compared in financial-year order: January is the
tenth month of the year, not the first.

Two heads have no proof and never will. Section 80CCD(2) is the employer's own
contribution, which the employer already knows, and declared other income raises
tax rather than reducing it. Nobody needs evidence to be taxed more.

One consequence is worth stating because it is the least obvious. Tax deducted
by a previous employer is a proof-backed head, so under verification it too
falls to what has been evidenced. An employee who has not produced their
previous employer's Form 16 loses that credit until they do.

The stored `taxComputation` records whether verified amounts were used and what
was allowed under each head, so a January jump in someone's TDS can be explained
from the payslip rather than guessed at.

**A declaration is not a proof.** Nothing collects, verifies or approves
evidence, and no statutory ceiling is enforced on a declared amount. The form
warns when a figure exceeds the ceiling it is subject to but still saves it,
because the system genuinely accepts it and the employee should know it will not
help them. Under the new regime the entries the regime ignores are marked rather
than silently accepted.

Payroll and settlement pages are gated to HR administrators in the browser as
well as at the API. The gate is not the security boundary, since the API already
refuses the calls; without it a non-admin who types the URL sees the full shell
and a wall of failed requests, which reads as a broken app rather than a page
they should not be on.

## Not implemented

Known and deliberate, so nobody assumes otherwise:

- **Form 16 Part A.** TRACES issues it. See above.
- **Slab editing.** Professional tax and income tax slabs are seeded, not
  edited through the interface. Rates and thresholds are editable; the slab
  tables themselves are not.
- **Statutory ceilings on a declared amount.** Section 80C above ₹1,50,000 is
  still accepted as declared. The forms warn but do not block, and a reviewer
  accepting a proof is not checking it against the ceiling either.
- **Automatic proof checking.** A person reads every document. Nothing extracts
  figures from a PDF or validates a policy number.
- **Section 10 exemptions other than HRA.** Leave travel allowance, children's
  education and similar are not tracked, because nothing records them.
- **Section 10(10AA) leave encashment exemption.** Encashment on exit is
  computed and paid; its exempt portion is not worked out.
- **TDS on a settlement.** Taken as supplied rather than computed from the
  year's position.
- **Marginal relief on surcharge.** Surcharge is applied at the flat slab rate.
  For income just above a threshold this overstates the liability.
- **Senior citizen exemptions.** The old regime uses the basic exemption for an
  individual below 60.
- **Half-yearly professional tax states.** Tamil Nadu and others that levy
  half-yearly are not modelled; configure a monthly equivalent or leave the levy
  off for those states.
- **Retrospective recalculation.** Changing a rate affects the next run. Runs
  already computed are not recalculated.
