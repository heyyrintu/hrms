/**
 * The shape of an employee tax declaration as a form: one row per figure, with
 * the wording that goes beside it.
 *
 * Both the employee's own editable declaration and payroll's read-only view of
 * an employee's declaration are built from this list, so the two cannot drift
 * apart and label the same figure differently.
 */

import { ALLOWED_UNDER_NEW_REGIME } from '@/types';
import type { EmployeeTaxDeclaration, UpsertTaxDeclarationPayload } from '@/types';

/**
 * The twelve rupee figures a declaration carries. Regime and year are not
 * amounts, and neither is `childrenCount`: it is a count of children, not
 * money, and is handled separately below rather than folded in here.
 */
export type DeclarationAmountKey =
  | 'section80C'
  | 'section80D'
  | 'section80CCD1B'
  | 'section80CCD2'
  | 'hraExemption'
  | 'ltaExemption'
  | 'childrenEducationAllowance'
  | 'hostelAllowance'
  | 'homeLoanInterest'
  | 'otherDeductions'
  | 'otherIncome'
  | 'previousEmployerTds'
  | 'previousEmployerEncashmentExemption';

/**
 * A ceiling the form is actually sure of, versus one it is guessing at.
 *
 * `amount` always has something to compare a declared figure against — a
 * best-effort default when nothing better is known — but `confirmed` says
 * whether that figure is the tenant's own configured limit or this feature's
 * fallback. A warning built from an unconfirmed ceiling must not print
 * `amount`, because it would read as the employer's own figure when it is
 * not.
 */
export interface ResolvedCeiling {
  amount: number;
  confirmed: boolean;
}

export interface DeclarationFieldSpec {
  key: DeclarationAmountKey;
  /** Used in labels and, verbatim, in the message when the entry is refused. */
  label: string;
  hint: string;
  /**
   * A statutory ceiling that is not sourced from tenant configuration — a
   * fixed figure this product applies the same way for everyone. Shown
   * exactly as given, without any "unconfirmed" hedging.
   */
  ceiling?: number;
  /**
   * A ceiling that should reflect what the tenant actually configured for
   * this financial year and regime, computed per render by the page (see
   * `resolveFlatCeiling` and `resolveChildrenAllowanceCeiling` below) and
   * laid over the base spec. Mutually exclusive with `ceiling` in practice —
   * a field uses one mechanism or the other, never both.
   */
  resolvedCeiling?: ResolvedCeiling;
}

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** "₹1,50,000" for 150000. Ceilings are constants written here, never parsed. */
export function formatCeiling(ceiling: number): string {
  return inrWhole.format(ceiling);
}

/**
 * Section 10(14) monthly ceilings, per child, for at most two children.
 *
 * Unlike the flat ceilings above, these cannot sit on a `DeclarationFieldSpec`
 * as a single number: the annual cap they imply depends on how many children
 * were declared, which is `childrenCount`, not a constant. The page computes
 * the effective ceiling for the year from these and shows it the same way.
 */
export const CHILDREN_EDUCATION_ALLOWANCE_MONTHLY_CEILING = 100;
export const HOSTEL_ALLOWANCE_MONTHLY_CEILING = 300;
export const CHILDREN_ALLOWANCE_MAX_CHILDREN = 2;

/**
 * Statutory defaults, used only when the tenant's own configured limit was
 * not supplied with the declaration. Never shown as a confirmed figure — see
 * `resolveFlatCeiling` and `ResolvedCeiling` above.
 */
export const SECTION_80C_DEFAULT_CEILING = 150000;

export const DECLARATION_FIELDS: readonly DeclarationFieldSpec[] = [
  {
    key: 'section80C',
    label: 'Section 80C',
    hint: 'Provident fund, life insurance premium, ELSS, principal on a home loan, tuition fees, and the rest of section 80C.',
    // No static `ceiling` here: section 80C's ceiling is tenant-configured, so
    // the page computes a `resolvedCeiling` from the declaration's `limits`
    // (falling back to `SECTION_80C_DEFAULT_CEILING`) and lays it over this
    // spec at render time, the same way it already does for the two
    // section 10(14) allowances below.
  },
  {
    key: 'section80D',
    label: 'Section 80D',
    hint: 'Health insurance premium for yourself, your family and your parents.',
  },
  {
    key: 'section80CCD1B',
    label: 'Section 80CCD(1B)',
    hint: 'Your own contribution to the National Pension System, over and above section 80C.',
    ceiling: 50000,
  },
  {
    key: 'section80CCD2',
    label: 'Section 80CCD(2)',
    hint: "Your employer's contribution to the National Pension System. This one applies under both regimes.",
  },
  {
    key: 'hraExemption',
    label: 'HRA exemption',
    hint: 'The exempt part of house rent allowance under section 10(13A), based on the rent you actually pay.',
  },
  {
    key: 'ltaExemption',
    label: 'LTA exemption',
    hint: 'Leave travel allowance under section 10(5): what you actually spent travelling, on a claim allowed twice in a block of four years.',
  },
  {
    key: 'childrenEducationAllowance',
    label: "Children's education allowance",
    // Deliberately does not state a monthly figure: the real cap is set per
    // tenant, and stating a number here would claim it before it is known.
    // The ceiling shown below, once you enter a figure, is that tenant's own
    // configured limit when the server supplied one.
    hint: `Section 10(14): tuition-related allowance, capped per child per month for at most ${CHILDREN_ALLOWANCE_MAX_CHILDREN} children under your employer's configured limit. Set how many children below; a figure above the cap is accepted but does not reduce your tax.`,
  },
  {
    key: 'hostelAllowance',
    label: 'Hostel allowance',
    hint: `Section 10(14): allowance for a child in a boarding hostel, capped per child per month for at most ${CHILDREN_ALLOWANCE_MAX_CHILDREN} children under your employer's configured limit. Set how many children below; a figure above the cap is accepted but does not reduce your tax.`,
  },
  {
    key: 'homeLoanInterest',
    label: 'Home loan interest',
    hint: 'Interest on a housing loan for a self-occupied property, under section 24(b).',
  },
  {
    key: 'otherDeductions',
    label: 'Other deductions',
    hint: 'Anything else under Chapter VI-A: 80E, 80G, 80TTA and the like.',
  },
  {
    key: 'otherIncome',
    label: 'Other income',
    hint: 'Income from elsewhere you want taken into account, such as bank interest. This raises the tax deducted, it does not lower it.',
  },
  {
    key: 'previousEmployerTds',
    label: 'Tax deducted by a previous employer',
    hint: 'Tax already deducted on salary paid by an earlier employer in this financial year.',
  },
  {
    key: 'previousEmployerEncashmentExemption',
    label: 'Leave encashment exemption used at a previous employer',
    hint: 'Section 10(10AA) is a lifetime ceiling, not one per employer. Enter how much of it you already used through leave encashment at an earlier employer; leaving this blank lets this employer apply the full ceiling again, over-exempting you.',
  },
];

/**
 * Whether the new regime simply disregards this figure.
 *
 * Derived from `ALLOWED_UNDER_NEW_REGIME` rather than restated, so a change to
 * what the regime allows reaches both pages without either being edited.
 */
export function isIgnoredUnderNewRegime(key: DeclarationAmountKey): boolean {
  return !ALLOWED_UNDER_NEW_REGIME.includes(key as keyof UpsertTaxDeclarationPayload);
}

/**
 * The stored figure for a field, as the decimal string the API sent.
 *
 * Nothing here parses it. The backend holds these as Prisma `Decimal` and a
 * rupee figure that has been through a float is no longer the figure stored.
 */
export function storedAmount(
  declaration: EmployeeTaxDeclaration,
  key: DeclarationAmountKey,
): string {
  return declaration[key];
}

// ---------------------------------------------------------------------------
// `childrenCount`: a count, not an amount
// ---------------------------------------------------------------------------

/**
 * How many children the employee has declared for section 10(14).
 *
 * Kept out of `DeclarationAmountKey` and `DECLARATION_FIELDS` deliberately: it
 * is a whole number of children, not a rupee figure, and formatting it as
 * money or parsing it as a decimal the way the fields above are would be
 * wrong on both ends. It drives the ceiling on `childrenEducationAllowance`
 * and `hostelAllowance` above rather than being a claim in its own right.
 */
export const CHILDREN_COUNT_FIELD = {
  key: 'childrenCount' as const,
  label: 'Number of children',
  hint: `Caps the education and hostel allowances above at, at most, ${CHILDREN_ALLOWANCE_MAX_CHILDREN} children — declaring more children than that does not raise the cap.`,
};

export type ParsedCount = { ok: true; value: number } | { ok: false; message: string };
/** @deprecated Kept as an alias; use `ParsedCount`. */
export type ParsedChildrenCount = ParsedCount;

/**
 * Reads a declared count — of children, or of anything else this form counts
 * rather than sums as money.
 *
 * Blank is nil, exactly as a blank rupee figure is: nothing has been
 * declared, which is sent as zero. Anything else must be a whole,
 * non-negative number — half of one or a negative one is refused rather than
 * silently floored or clamped, the same discipline `parseDeclaredAmount`
 * applies to the rupee figures. `label` is the field's own label and appears
 * verbatim in any refusal, the same convention `parseDeclaredAmount` follows.
 */
export function parseCount(raw: string, label: string): ParsedCount {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: true, value: 0 };
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      message: `${label} must be a whole number. "${trimmed}" is not one, so nothing was sent.`,
    };
  }
  return { ok: true, value: Number(trimmed) };
}

/** `parseCount` for `CHILDREN_COUNT_FIELD` specifically. */
export function parseChildrenCount(raw: string): ParsedCount {
  return parseCount(raw, CHILDREN_COUNT_FIELD.label);
}

/**
 * The annual ceiling for a section 10(14) children's allowance, given how
 * many children were declared.
 *
 * Capped at `maxChildren` even when more are declared, and annualised over
 * twelve months because the declaration itself is an annual figure. Nothing
 * enforces this ceiling — like the flat ones above, it exists so the form
 * can warn at the point of entry, not to block the entry.
 *
 * `maxChildren` defaults to `CHILDREN_ALLOWANCE_MAX_CHILDREN` — the fallback
 * used when the tenant has not configured one, never the source of truth —
 * so existing callers that have not been taught about the tenant's own
 * configured maximum keep behaving exactly as they did before it existed.
 */
export function childrenAllowanceCeiling(
  monthlyLimit: number,
  childrenCount: number,
  maxChildren: number = CHILDREN_ALLOWANCE_MAX_CHILDREN,
): number {
  const wholeChildren = Number.isFinite(childrenCount) ? Math.max(0, Math.floor(childrenCount)) : 0;
  const effectiveMax =
    Number.isFinite(maxChildren) && maxChildren > 0
      ? Math.floor(maxChildren)
      : CHILDREN_ALLOWANCE_MAX_CHILDREN;
  const countedChildren = Math.min(wholeChildren, effectiveMax);
  return monthlyLimit * 12 * countedChildren;
}

// ---------------------------------------------------------------------------
// Ceilings sourced from the tenant's own configuration, with a fallback
// ---------------------------------------------------------------------------

/**
 * Reads one configured statutory limit as the server might send it.
 *
 * Null for anything that is not a usable non-negative figure — absent, blank,
 * unparseable, or negative — never defaulted to zero, because zero would
 * itself be a specific figure nobody confirmed. Accepts a number too, in case
 * the server sends one rather than the decimal string every other money field
 * on this form arrives as.
 */
function readConfiguredLimit(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * A flat ceiling — section 80C's — from the tenant's configured limit when
 * the server supplied one, or `fallback` when it did not.
 *
 * `confirmed` tells the caller which happened, so a warning built from the
 * result knows whether it may print `amount` as a real figure.
 */
export function resolveFlatCeiling(
  configured: string | number | undefined | null,
  fallback: number,
): ResolvedCeiling {
  const value = readConfiguredLimit(configured);
  return value !== null ? { amount: value, confirmed: true } : { amount: fallback, confirmed: false };
}

/**
 * Reads a configured maximum child count as the server might send it.
 *
 * Null for anything that is not a usable whole positive count — absent,
 * zero, negative or non-finite — never defaulted to
 * `CHILDREN_ALLOWANCE_MAX_CHILDREN` here: that fallback is applied by the
 * caller, the same "configured or fallback" shape `readConfiguredLimit`
 * already follows for the rupee ceilings.
 */
function readConfiguredMaxChildren(raw: number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

/**
 * The annual ceiling for a section 10(14) children's allowance, from the
 * tenant's configured monthly limit when the server supplied one, or
 * `fallbackMonthly` when it did not — scaled by `childrenCount` and capped at
 * the tenant's configured maximum child count when the server supplied one,
 * or `CHILDREN_ALLOWANCE_MAX_CHILDREN` when it did not, via
 * `childrenAllowanceCeiling`.
 *
 * `confirmed` follows the monthly limit alone, exactly as it did before the
 * maximum child count was itself configurable: the maximum only changes how
 * many children the monthly limit is multiplied by, not whether the monthly
 * figure driving that multiplication is the employer's own.
 */
export function resolveChildrenAllowanceCeiling(
  configuredMonthly: string | number | undefined | null,
  fallbackMonthly: number,
  childrenCount: number,
  configuredMaxChildren?: number | null,
): ResolvedCeiling {
  const configured = readConfiguredLimit(configuredMonthly);
  const effectiveMonthly = configured !== null ? configured : fallbackMonthly;
  const maxChildren = readConfiguredMaxChildren(configuredMaxChildren);
  const effectiveMaxChildren = maxChildren !== null ? maxChildren : CHILDREN_ALLOWANCE_MAX_CHILDREN;
  return {
    amount: childrenAllowanceCeiling(effectiveMonthly, childrenCount, effectiveMaxChildren),
    confirmed: configured !== null,
  };
}

// ---------------------------------------------------------------------------
// `ltaJourneysUsedInBlock`: a count, not an amount
// ---------------------------------------------------------------------------

/**
 * Section 10(5) allows two journeys in a block of four calendar years. Both
 * figures are the Act's own, not something a tenant configures, so — unlike
 * the ceilings above — they are stated as fact rather than routed through a
 * "confirmed or fallback" resolver.
 */
export const LTA_JOURNEYS_PER_BLOCK = 2;
export const LTA_BLOCK_LENGTH_YEARS = 4;

/**
 * How many leave-travel journeys the employee has already used in the current
 * block, including at an earlier employer.
 *
 * Kept out of `DeclarationAmountKey` and `DECLARATION_FIELDS` for the same
 * reason `childrenCount` is: it counts journeys, not rupees, and belongs next
 * to `ltaExemption` on the form as context for that claim rather than as a
 * claim of its own.
 */
export const LTA_JOURNEYS_FIELD = {
  key: 'ltaJourneysUsedInBlock' as const,
  label: 'LTA journeys already used in this block',
  hint: `Section 10(5) allows ${LTA_JOURNEYS_PER_BLOCK} journeys in a block of ${LTA_BLOCK_LENGTH_YEARS} calendar years. Declare how many you have already used in the current block — including at an earlier employer — so a third is not claimed by accident.`,
};

/** `parseCount` for `LTA_JOURNEYS_FIELD` specifically. */
export function parseLtaJourneysUsedInBlock(raw: string): ParsedCount {
  return parseCount(raw, LTA_JOURNEYS_FIELD.label);
}

/**
 * The warning for a declared journey count above what the block allows, or
 * null when there is nothing to warn about.
 *
 * Nothing enforces this either: the count is still saved exactly as entered,
 * the same "warns and still saves" discipline every ceiling above follows.
 */
export function ltaJourneysWarning(journeysUsedInBlock: number): string | null {
  if (!Number.isFinite(journeysUsedInBlock) || journeysUsedInBlock <= LTA_JOURNEYS_PER_BLOCK) {
    return null;
  }
  return `Only ${LTA_JOURNEYS_PER_BLOCK} journeys are allowed in a block of ${LTA_BLOCK_LENGTH_YEARS} calendar years. At ${journeysUsedInBlock}, this is already over that, and it will not reduce your tax.`;
}

/**
 * The warning for an LTA exemption claim that cannot reduce tax because the
 * block is already exhausted, or null when there is nothing to warn about.
 *
 * Two conditions both have to hold: the block already has no journeys left
 * (`journeysUsedInBlock` at or over `LTA_JOURNEYS_PER_BLOCK`), and an amount
 * has actually been declared against it. Either alone is fine — a full block
 * with nothing claimed costs nothing, and a claim with room left in the block
 * is exactly what the exemption is for.
 *
 * Shown on the leave travel field itself (`ltaExemption`), not on the journey
 * count: the employee is looking at the figure this affects, not the count
 * that explains why. Like every other warning here, this does not stop the
 * save — the figure is still sent exactly as declared.
 */
export function ltaExemptionBlockExhaustedWarning(
  journeysUsedInBlock: number,
  ltaExemptionAmount: number,
): string | null {
  if (!Number.isFinite(journeysUsedInBlock) || journeysUsedInBlock < LTA_JOURNEYS_PER_BLOCK) {
    return null;
  }
  if (!Number.isFinite(ltaExemptionAmount) || ltaExemptionAmount <= 0) {
    return null;
  }
  return `The block already has ${LTA_JOURNEYS_PER_BLOCK} of ${LTA_JOURNEYS_PER_BLOCK} journeys used in this ${LTA_BLOCK_LENGTH_YEARS}-year period, so this will not reduce your tax.`;
}

// ---------------------------------------------------------------------------
// `form10EFurnished`: a boolean, not an amount or a count
// ---------------------------------------------------------------------------

/**
 * Whether Form 10E has been furnished to the Income Tax Department for this
 * year.
 *
 * Section 192(2A) lets an employer compute section 89 relief — on a
 * settlement, most often — only on particulars furnished in that form, so a
 * settlement refuses the relief until it is furnished. The employee furnishes
 * the form to the department itself; this field only records that they have.
 *
 * Kept out of `DeclarationAmountKey` and `DECLARATION_FIELDS` for the same
 * reason `childrenCount` and `ltaJourneysUsedInBlock` are: it is not a rupee
 * figure or a count, and following the shape of those two existing fields —
 * rather than inventing something new — is what this codebase already does
 * for a fact about the declaration that is neither.
 */
export const FORM_10E_FURNISHED_FIELD = {
  key: 'form10EFurnished' as const,
  label: 'Form 10E furnished',
  hint: 'Without Form 10E on file with the Income Tax Department, your employer cannot reduce the tax it deducts on a settlement for section 89 relief — you would need to claim that relief yourself when you file your own return instead. Tick this once you have furnished the form.',
};
