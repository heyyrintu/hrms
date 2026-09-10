'use client';

/**
 * The employee's own tax declaration.
 *
 * What an employee expects to claim for the year, so that the tax deducted from
 * their salary is computed on something better than salary alone. Nothing here
 * collects or checks proof; see `DeclarationCaveat`, which says so on the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, Save } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { statutoryApi } from '@/lib/api';
import type {
  EmployeeTaxDeclaration,
  TaxRegimeName,
  UpsertTaxDeclarationPayload,
} from '@/types';

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
  EditableDeclarationField,
  ignoredForRegime,
} from '@/components/declaration/DeclarationFieldRow';
import {
  DECLARATION_FIELDS,
  DeclarationAmountKey,
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
function amountsFrom(declaration: EmployeeTaxDeclaration): AmountMap {
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
  const [declaration, setDeclaration] = useState<EmployeeTaxDeclaration | null>(null);
  const [regime, setRegime] = useState<TaxRegimeName>('NEW');
  const [amounts, setAmounts] = useState<AmountMap>(EMPTY_AMOUNTS);
  const [errors, setErrors] = useState<ErrorMap>({});
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

      const data = (response.data ?? null) as EmployeeTaxDeclaration | null;
      setDeclaration(data);
      setErrors({});
      if (data) {
        setRegime(data.regime);
        setAmounts(amountsFrom(data));
      } else {
        // No row yet. The form starts empty rather than at zero: an employee
        // has declared nothing, which is not the same as declaring nil.
        setRegime('NEW');
        setAmounts(EMPTY_AMOUNTS);
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

  const handleSave = async () => {
    const nextErrors: ErrorMap = {};
    const payload: UpsertTaxDeclarationPayload = { financialYear, regime };

    for (const field of DECLARATION_FIELDS) {
      const parsed = parseDeclaredAmount(amounts[field.key], field.label);
      if (parsed.ok) {
        payload[field.key] = parsed.value;
      } else {
        nextErrors[field.key] = parsed.message;
      }
    }

    setErrors(nextErrors);
    // Nothing is sent while any entry is unreadable. Dropping the bad entry and
    // saving the rest would write a zero nobody typed into the basis for tax.
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Nothing was saved. Check the entries marked below.');
      return;
    }

    setSaving(true);
    try {
      const response = await statutoryApi.saveMyDeclaration(payload);
      setDeclaration((response.data ?? null) as EmployeeTaxDeclaration | null);
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
                {DECLARATION_FIELDS.map((field) => (
                  <EditableDeclarationField
                    key={field.key}
                    field={field}
                    value={amounts[field.key]}
                    onChange={(value) => setAmount(field.key, value)}
                    error={errors[field.key]}
                    ignored={ignoredForRegime(field.key, regime)}
                    disabled={saving}
                  />
                ))}
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
