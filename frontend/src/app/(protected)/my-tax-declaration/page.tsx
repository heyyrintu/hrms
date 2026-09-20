'use client';

/**
 * The employee's own tax declaration.
 *
 * What an employee expects to claim for the year, so that the tax deducted from
 * their salary is computed on something better than salary alone. Nothing here
 * collects or checks proof; see `DeclarationCaveat`, which says so on the page.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Save } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { statutoryApi } from '@/lib/api';
import type { TaxRegimeName } from '@/types';

import {
  currentFinancialYear,
  financialYearLabel,
  financialYearOptions,
} from '@/components/form16/financialYear';
import { formatINR } from '@/components/form16/money';
import {
  ClosedYearNotice,
  DeclarationCaveat,
  NewRegimeNotice,
  NoDeclarationNotice,
} from '@/components/declaration/DeclarationNotices';
import {
  EditableCountField,
  EditableDeclarationField,
  ignoredForRegime,
} from '@/components/declaration/DeclarationFieldRow';
import {
  CHILDREN_COUNT_FIELD,
  CHILDREN_EDUCATION_ALLOWANCE_MONTHLY_CEILING,
  DECLARATION_FIELDS,
  DeclarationAmountKey,
  DeclarationFieldSpec,
  DeclarationWithNewFields,
  HOSTEL_ALLOWANCE_MONTHLY_CEILING,
  LTA_JOURNEYS_FIELD,
  SECTION_80C_DEFAULT_CEILING,
  UpsertPayloadWithNewFields,
  ltaJourneysWarning,
  parseChildrenCount,
  parseLtaJourneysUsedInBlock,
  resolveChildrenAllowanceCeiling,
  resolveFlatCeiling,
} from '@/components/declaration/fields';
import { parseDeclaredAmount } from '@/components/declaration/parseAmount';

type AmountMap = Record<DeclarationAmountKey, string>;
type ErrorMap = Partial<Record<DeclarationAmountKey, string>>;

const EMPTY_AMOUNTS: AmountMap = DECLARATION_FIELDS.reduce((acc, field) => {
  acc[field.key] = '';
  return acc;
}, {} as AmountMap);

/**
 * The form's values, taken from the stored decimal strings as they arrived.
 *
 * Not parsed: the input carries the string, and only the save path turns it
 * into a number.
 */
function amountsFrom(declaration: DeclarationWithNewFields): AmountMap {
  return DECLARATION_FIELDS.reduce((acc, field) => {
    acc[field.key] = declaration[field.key] ?? '';
    return acc;
  }, {} as AmountMap);
}

const REGIME_OPTIONS = [
  { value: 'NEW', label: 'New regime — section 115BAC' },
  { value: 'OLD', label: 'Old regime — with Chapter VI-A deductions' },
];

export default function MyTaxDeclarationPage() {
  const [financialYear, setFinancialYear] = useState<number>(() => currentFinancialYear());
  const [declaration, setDeclaration] = useState<DeclarationWithNewFields | null>(null);
  const [regime, setRegime] = useState<TaxRegimeName>('NEW');
  const [amounts, setAmounts] = useState<AmountMap>(EMPTY_AMOUNTS);
  const [errors, setErrors] = useState<ErrorMap>({});
  // `childrenCount` and `ltaJourneysUsedInBlock` are counts, not rupee figures
  // in `amounts`, so each is tracked separately and parsed with its own,
  // integer-only rule.
  const [childrenCount, setChildrenCountValue] = useState('');
  const [childrenCountError, setChildrenCountError] = useState<string | undefined>();
  const [ltaJourneysUsedInBlock, setLtaJourneysUsedInBlockValue] = useState('');
  const [ltaJourneysError, setLtaJourneysError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** Generation counter identifying the newest in-flight load. */
  const requestRef = useRef(0);

  const yearOptions = useMemo(() => financialYearOptions(), []);
  const yearInProgress = useMemo(() => currentFinancialYear(), []);
  const yearHasEnded = financialYear < yearInProgress;

  const load = useCallback(async () => {
    // The year is a click away and one request can outlive the next. Without
    // this token a slow reply would fill the form under whichever year is
    // selected by the time it lands, showing one year's figures under another.
    const request = requestRef.current + 1;
    requestRef.current = request;

    setLoading(true);
    try {
      const response = await statutoryApi.getMyDeclaration(financialYear);
      if (requestRef.current !== request) return;

      const data = (response.data ?? null) as DeclarationWithNewFields | null;
      setDeclaration(data);
      setErrors({});
      setChildrenCountError(undefined);
      setLtaJourneysError(undefined);
      if (data) {
        setRegime(data.regime);
        setAmounts(amountsFrom(data));
        setChildrenCountValue(String(data.childrenCount ?? 0));
        setLtaJourneysUsedInBlockValue(String(data.ltaJourneysUsedInBlock ?? 0));
      } else {
        // No row yet. The form starts empty rather than at zero: an employee
        // has declared nothing, which is not the same as declaring nil.
        setRegime('NEW');
        setAmounts(EMPTY_AMOUNTS);
        setChildrenCountValue('');
        setLtaJourneysUsedInBlockValue('');
      }
    } catch {
      if (requestRef.current !== request) return;
      setDeclaration(null);
      toast.error('Your tax declaration could not be read. Nothing below is from your record.');
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [financialYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const setAmount = (key: DeclarationAmountKey, value: string) => {
    setAmounts((previous) => ({ ...previous, [key]: value }));
    // Clearing the field's own error as it is retyped keeps a stale refusal
    // from sitting under a value that has since been corrected.
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const setChildrenCount = (value: string) => {
    setChildrenCountValue(value);
    setChildrenCountError(undefined);
  };

  const setLtaJourneysUsedInBlock = (value: string) => {
    setLtaJourneysUsedInBlockValue(value);
    setLtaJourneysError(undefined);
  };

  // A best-effort read of the children count for the two allowance ceilings
  // below, while the user is still typing. An unreadable entry shows a
  // ceiling of nil rather than crashing the ceiling display; the actual save
  // refuses it outright, in `handleSave`.
  const childrenCountForCeiling = (() => {
    const parsed = parseChildrenCount(childrenCount);
    return parsed.ok ? parsed.value : 0;
  })();

  // Same best-effort reading, for the "too many journeys" warning below.
  const ltaJourneysForWarning = (() => {
    const parsed = parseLtaJourneysUsedInBlock(ltaJourneysUsedInBlock);
    return parsed.ok ? parsed.value : 0;
  })();

  const handleSave = async () => {
    const nextErrors: ErrorMap = {};
    const payload: UpsertPayloadWithNewFields = { financialYear, regime };

    for (const field of DECLARATION_FIELDS) {
      const parsed = parseDeclaredAmount(amounts[field.key], field.label);
      if (parsed.ok) {
        payload[field.key] = parsed.value;
      } else {
        nextErrors[field.key] = parsed.message;
      }
    }

    const parsedChildrenCount = parseChildrenCount(childrenCount);
    let nextChildrenCountError: string | undefined;
    if (parsedChildrenCount.ok) {
      payload.childrenCount = parsedChildrenCount.value;
    } else {
      nextChildrenCountError = parsedChildrenCount.message;
    }
    setChildrenCountError(nextChildrenCountError);

    const parsedLtaJourneys = parseLtaJourneysUsedInBlock(ltaJourneysUsedInBlock);
    let nextLtaJourneysError: string | undefined;
    if (parsedLtaJourneys.ok) {
      payload.ltaJourneysUsedInBlock = parsedLtaJourneys.value;
    } else {
      nextLtaJourneysError = parsedLtaJourneys.message;
    }
    setLtaJourneysError(nextLtaJourneysError);

    setErrors(nextErrors);
    // Nothing is sent while any entry is unreadable. Dropping the bad entry and
    // saving the rest would write a zero nobody typed into the basis for tax.
    if (Object.keys(nextErrors).length > 0 || nextChildrenCountError || nextLtaJourneysError) {
      toast.error('Nothing was saved. Check the entries marked below.');
      return;
    }

    setSaving(true);
    try {
      const response = await statutoryApi.saveMyDeclaration(payload);
      setDeclaration((response.data ?? null) as DeclarationWithNewFields | null);
      toast.success('Your declaration was saved. It applies from the next payroll run.');
    } catch {
      toast.error('Your declaration could not be saved. Nothing on your record was changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-warm-900 sm:text-2xl">My tax declaration</h1>
        <p className="mt-1 text-sm text-warm-600">
          What you expect to claim this year, so the tax deducted from your salary is closer to
          the tax you actually owe.
        </p>
      </div>

      <DeclarationCaveat audience="employee" />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Financial year"
            value={String(financialYear)}
            onChange={(event) => setFinancialYear(Number(event.target.value))}
            options={yearOptions}
          />
          <Select
            label="Tax regime"
            value={regime}
            onChange={(event) => setRegime(event.target.value as TaxRegimeName)}
            options={REGIME_OPTIONS}
          />
        </CardContent>
      </Card>

      {yearHasEnded ? (
        <ClosedYearNotice financialYear={financialYear} audience="employee" />
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : (
        <>
          {declaration ? (
            <div data-testid="declaration-on-record">
              <Card>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 text-warm-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-warm-900">
                    On record for {financialYearLabel(declaration.financialYear)}
                  </h2>
                  <Badge variant={declaration.regime === 'NEW' ? 'info' : 'gray'}>
                    {declaration.regime === 'NEW' ? 'New regime' : 'Old regime'}
                  </Badge>
                </div>
                <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {DECLARATION_FIELDS.map((field) => (
                    <div key={field.key} className="flex items-baseline justify-between gap-4">
                      <dt className="text-xs text-warm-500">{field.label}</dt>
                      {/* Formatted from the stored string; never through a float. */}
                      <dd className="text-xs font-medium tabular-nums text-warm-800">
                        {formatINR(declaration[field.key])}
                      </dd>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-xs text-warm-500">{CHILDREN_COUNT_FIELD.label}</dt>
                    {/* A count, not rupees, so it is not run through formatINR. */}
                    <dd className="text-xs font-medium tabular-nums text-warm-800">
                      {declaration.childrenCount}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-xs text-warm-500">{LTA_JOURNEYS_FIELD.label}</dt>
                    <dd className="text-xs font-medium tabular-nums text-warm-800">
                      {declaration.ltaJourneysUsedInBlock}
                    </dd>
                  </div>
                </dl>
              </CardContent>
              </Card>
            </div>
          ) : (
            <NoDeclarationNotice financialYear={financialYear} audience="employee" />
          )}

          {regime === 'NEW' ? <NewRegimeNotice audience="employee" /> : null}

          <Card>
            <CardContent className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                {DECLARATION_FIELDS.map((field) => {
                  // The counts that drive the allowances below have to be
                  // entered somewhere, and each belongs right before the
                  // figure it gives context to rather than off on its own.
                  const countField =
                    field.key === 'childrenEducationAllowance' ? (
                      <EditableCountField
                        key="childrenCount"
                        id="childrenCount"
                        label={CHILDREN_COUNT_FIELD.label}
                        hint={CHILDREN_COUNT_FIELD.hint}
                        value={childrenCount}
                        onChange={setChildrenCount}
                        error={childrenCountError}
                        disabled={saving}
                      />
                    ) : field.key === 'ltaExemption' ? (
                      <EditableCountField
                        key="ltaJourneysUsedInBlock"
                        id="ltaJourneysUsedInBlock"
                        label={LTA_JOURNEYS_FIELD.label}
                        hint={LTA_JOURNEYS_FIELD.hint}
                        value={ltaJourneysUsedInBlock}
                        onChange={setLtaJourneysUsedInBlock}
                        error={ltaJourneysError}
                        disabled={saving}
                        warning={ltaJourneysWarning(ltaJourneysForWarning) ?? undefined}
                      />
                    ) : null;

                  // Three ceilings depend on something other than a fixed
                  // constant — the tenant's own configuration, the declared
                  // children count, or both — so they cannot sit on the
                  // shared spec as one. Each is resolved here and laid over
                  // the field for this render only, reusing the same warning
                  // every other figure gets; see `resolveFlatCeiling` and
                  // `resolveChildrenAllowanceCeiling` in `./fields`.
                  const effectiveField: DeclarationFieldSpec =
                    field.key === 'section80C'
                      ? {
                          ...field,
                          resolvedCeiling: resolveFlatCeiling(
                            declaration?.limits?.section80CLimit,
                            SECTION_80C_DEFAULT_CEILING,
                          ),
                        }
                      : field.key === 'childrenEducationAllowance'
                        ? {
                            ...field,
                            resolvedCeiling: resolveChildrenAllowanceCeiling(
                              declaration?.limits?.childrenEducationMonthlyLimit,
                              CHILDREN_EDUCATION_ALLOWANCE_MONTHLY_CEILING,
                              childrenCountForCeiling,
                            ),
                          }
                        : field.key === 'hostelAllowance'
                          ? {
                              ...field,
                              resolvedCeiling: resolveChildrenAllowanceCeiling(
                                declaration?.limits?.hostelAllowanceMonthlyLimit,
                                HOSTEL_ALLOWANCE_MONTHLY_CEILING,
                                childrenCountForCeiling,
                              ),
                            }
                          : field;

                  return (
                    <Fragment key={field.key}>
                      {countField}
                      <EditableDeclarationField
                        field={effectiveField}
                        value={amounts[field.key]}
                        onChange={(value) => setAmount(field.key, value)}
                        error={errors[field.key]}
                        ignored={ignoredForRegime(field.key, regime)}
                        disabled={saving}
                      />
                    </Fragment>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-warm-100 pt-4">
                <p className="text-xs text-warm-500">
                  A blank field is saved as nil. Figures take effect from the next payroll run;
                  runs already computed are not recalculated.
                </p>
                <Button onClick={() => void handleSave()} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                  {saving ? 'Saving…' : 'Save declaration'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
