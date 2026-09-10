'use client';

/**
 * Editing the two slab tables statutory payroll reads: professional tax by
 * state, and the income tax ladder by financial year, regime and age band.
 *
 * These are the figures every payslip's deduction is computed from. A wrong
 * professional tax row mis-deducts a whole state; a wrong income tax band
 * mis-deducts everyone the band applies to. So nothing here writes on a
 * single click — every save and every delete is confirmed first, against a
 * plain statement of what it changes and from when — and an income tax ladder
 * is always replaced whole, because a ladder with a gap or an overlap in it is
 * not a ladder.
 *
 * The role gate for everything under /admin lives in the admin layout; there
 * is deliberately none here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  Landmark,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import {
  formatMoney,
  formatPercent,
  isReadableDecimal,
  validateNumeric,
} from '@/components/statutory/decimal';
import { currentFinancialYear, financialYearLabel } from '@/components/form16/financialYear';
import { extractErrorMessage, parseLadderError } from '@/components/slabs/ladderErrors';
import { slabsApi } from '@/lib/api';
import type {
  IncomeTaxConfig,
  IncomeTaxConfigPayload,
  IncomeTaxSlabPayload,
  ProfessionalTaxSlab,
  ProfessionalTaxSlabPayload,
  TaxRegimeName,
} from '@/types';

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const STATES = [
  'Karnataka',
  'Maharashtra',
  'West Bengal',
  'Telangana',
  'Andhra Pradesh',
  'Gujarat',
  'Madhya Pradesh',
  'Tamil Nadu',
  'Kerala',
  'Punjab',
  'Bihar',
  'Odisha',
  'Assam',
  'Delhi',
];

type AgeBand = 'GENERAL' | 'SENIOR' | 'SUPER_SENIOR';

const AGE_BAND_OPTIONS: { value: AgeBand; label: string }[] = [
  { value: 'GENERAL', label: 'General' },
  { value: 'SENIOR', label: 'Senior citizen (60 and above)' },
  { value: 'SUPER_SENIOR', label: 'Super senior citizen (80 and above)' },
];

const REGIME_OPTIONS: { value: TaxRegimeName; label: string }[] = [
  { value: 'OLD', label: 'Old regime' },
  { value: 'NEW', label: 'New regime' },
];

/** `'0.00'` to `'24999.00'` reads as one range, so no bound stands alone. */
function rangeLabel(fromAmount: string, toAmount: string | null): string {
  if (toAmount === null) return `${formatMoney(fromAmount)} and above`;
  return `${formatMoney(fromAmount)} – ${formatMoney(toAmount)}`;
}

/** The years a slab table can reasonably be set up for: a few back, a couple ahead. */
function yearOptions(): { value: string; label: string }[] {
  const base = currentFinancialYear();
  const years: number[] = [];
  for (let year = base + 2; year >= base - 3; year -= 1) years.push(year);
  return years.map((year) => ({ value: String(year), label: financialYearLabel(year) }));
}

function EffectiveNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warm-200 bg-warm-50 p-3">
      <p className="text-xs leading-relaxed text-warm-700">
        A change here takes effect from the next payroll run. Runs already computed are not
        recalculated, so a slab corrected after a run has been processed will not change that
        run&apos;s payslips.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Professional tax
// ---------------------------------------------------------------------------

interface PtDraft {
  fromAmount: string;
  toAmount: string;
  noUpperBound: boolean;
  amount: string;
  februaryAmount: string;
  gender: string;
}

const EMPTY_PT_DRAFT: PtDraft = {
  fromAmount: '',
  toAmount: '',
  noUpperBound: false,
  amount: '',
  februaryAmount: '',
  gender: '',
};

function ptDraftFrom(slab: ProfessionalTaxSlab): PtDraft {
  return {
    fromAmount: slab.fromAmount,
    toAmount: slab.toAmount ?? '',
    noUpperBound: slab.toAmount === null,
    amount: slab.amount,
    februaryAmount: slab.februaryAmount ?? '',
    gender: slab.gender ?? '',
  };
}

function validatePtDraft(draft: PtDraft): Partial<Record<keyof PtDraft, string>> {
  const errors: Partial<Record<keyof PtDraft, string>> = {};
  const fromError = validateNumeric(draft.fromAmount, 'From', 'amount');
  if (fromError) errors.fromAmount = fromError;
  if (!draft.noUpperBound) {
    const toError = validateNumeric(draft.toAmount, 'To', 'amount');
    if (toError) errors.toAmount = toError;
  }
  const amountError = validateNumeric(draft.amount, 'Amount per month', 'amount');
  if (amountError) errors.amount = amountError;
  if (draft.februaryAmount.trim() !== '') {
    const febError = validateNumeric(draft.februaryAmount, 'February amount', 'amount');
    if (febError) errors.februaryAmount = febError;
  }
  return errors;
}

function ptPayloadFrom(state: string, draft: PtDraft): ProfessionalTaxSlabPayload {
  return {
    state,
    fromAmount: Number(draft.fromAmount),
    toAmount: draft.noUpperBound ? null : Number(draft.toAmount),
    amount: Number(draft.amount),
    februaryAmount: draft.februaryAmount.trim() === '' ? null : Number(draft.februaryAmount),
    gender: draft.gender.trim() === '' ? null : draft.gender,
  };
}

function ProfessionalTaxSection() {
  const [state, setState] = useState(STATES[0]);
  const [slabs, setSlabs] = useState<ProfessionalTaxSlab[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProfessionalTaxSlab | null>(null);
  const [draft, setDraft] = useState<PtDraft>(EMPTY_PT_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof PtDraft, string>>>({});

  const [pendingPayload, setPendingPayload] = useState<ProfessionalTaxSlabPayload | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ProfessionalTaxSlab | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await slabsApi.listProfessionalTax(state);
      const rows = (response?.data ?? []) as ProfessionalTaxSlab[];
      setSlabs([...rows].sort((a, b) => Number(a.fromAmount) - Number(b.fromAmount)));
    } catch {
      setSlabs([]);
      toast.error('Professional tax slabs could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [state]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_PT_DRAFT);
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = (slab: ProfessionalTaxSlab) => {
    setEditing(slab);
    setDraft(ptDraftFrom(slab));
    setFieldErrors({});
    setModalOpen(true);
  };

  const setField = <K extends keyof PtDraft>(key: K, value: PtDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleModalSave = () => {
    const errors = validatePtDraft(draft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstMessage = Object.values(errors)[0];
      if (firstMessage) toast.error(firstMessage);
      return;
    }
    setPendingPayload(ptPayloadFrom(state, draft));
    setModalOpen(false);
    setConfirmOpen(true);
  };

  const handleConfirmSave = async () => {
    if (!pendingPayload) return;
    setSaving(true);
    try {
      if (editing) {
        await slabsApi.updateProfessionalTax(editing.id, pendingPayload);
      } else {
        await slabsApi.createProfessionalTax(pendingPayload);
      }
      toast.success('Saved. It applies from the next payroll run.');
      setConfirmOpen(false);
      setPendingPayload(null);
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(
        extractErrorMessage(error, 'The professional tax band could not be saved.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await slabsApi.deleteProfessionalTax(deleteTarget.id);
      toast.success('Deleted. It applies from the next payroll run.');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'The professional tax band could not be deleted.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-5 w-5 text-primary-600" aria-hidden="true" />
            Professional tax slabs
          </CardTitle>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="State"
            aria-label="State"
            value={state}
            onChange={(event) => setState(event.target.value)}
            options={STATES.map((name) => ({ value: name, label: name }))}
          />
        </div>

        {loading ? (
          <p className="text-sm text-warm-500">Loading slabs…</p>
        ) : slabs.length === 0 ? (
          <p className="text-sm text-warm-600">
            No professional tax slabs are set up for {state} yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label={`Professional tax bands for ${state}`} className="w-full text-sm">
              <thead>
                <tr className="border-b border-warm-200 text-left text-xs uppercase tracking-wide text-warm-500">
                  <th className="py-2 pr-4 font-medium">Monthly wages</th>
                  <th className="py-2 pr-4 font-medium">Tax per month</th>
                  <th className="py-2 pr-4 font-medium">February</th>
                  <th className="py-2 pr-4 font-medium">Applies to</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {slabs.map((slab) => (
                  <tr
                    key={slab.id}
                    data-testid={`pt-row-${slab.id}`}
                    className="border-b border-warm-100 last:border-0"
                  >
                    <td className="py-2 pr-4 text-warm-800">
                      {rangeLabel(slab.fromAmount, slab.toAmount)}
                    </td>
                    <td className="py-2 pr-4 font-medium text-warm-900">
                      {formatMoney(slab.amount)}
                    </td>
                    <td className="py-2 pr-4 text-warm-600">
                      {slab.februaryAmount === null ? 'Same' : formatMoney(slab.februaryAmount)}
                    </td>
                    <td className="py-2 pr-4 text-warm-600">
                      {slab.gender === null ? 'Everyone' : slab.gender}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          aria-label="Edit"
                          onClick={() => openEdit(slab)}
                          className="rounded-lg p-1.5 text-warm-400 hover:bg-warm-100 hover:text-warm-700"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete"
                          onClick={() => setDeleteTarget(slab)}
                          className="rounded-lg p-1.5 text-warm-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add professional tax band
        </Button>
      </CardContent>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit professional tax band' : 'Add professional tax band'}
      >
        <div className="space-y-4">
          <p className="text-xs text-warm-500">For {state}.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="From (₹)"
              aria-label="From (₹)"
              type="text"
              inputMode="decimal"
              value={draft.fromAmount}
              error={fieldErrors.fromAmount}
              onChange={(event) => setField('fromAmount', event.target.value)}
            />
            <div>
              <Input
                label="To (₹)"
                aria-label="To (₹)"
                type="text"
                inputMode="decimal"
                value={draft.toAmount}
                disabled={draft.noUpperBound}
                error={fieldErrors.toAmount}
                onChange={(event) => setField('toAmount', event.target.value)}
              />
              <label className="mt-1.5 flex items-center gap-2 text-xs text-warm-600">
                <input
                  type="checkbox"
                  aria-label="No upper bound (top band)"
                  checked={draft.noUpperBound}
                  onChange={(event) => setField('noUpperBound', event.target.checked)}
                />
                No upper bound (top band)
              </label>
            </div>
          </div>
          <Input
            label="Amount per month (₹)"
            aria-label="Amount per month (₹)"
            type="text"
            inputMode="decimal"
            value={draft.amount}
            error={fieldErrors.amount}
            onChange={(event) => setField('amount', event.target.value)}
          />
          <Input
            label="February amount (₹)"
            aria-label="February amount (₹)"
            type="text"
            inputMode="decimal"
            placeholder="Same as other months"
            value={draft.februaryAmount}
            error={fieldErrors.februaryAmount}
            onChange={(event) => setField('februaryAmount', event.target.value)}
          />
          <Select
            label="Applies to"
            aria-label="Applies to"
            value={draft.gender}
            onChange={(event) => setField('gender', event.target.value)}
            options={[
              { value: '', label: 'Everyone' },
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
            ]}
          />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleModalSave}>
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            Save band
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm professional tax change"
      >
        {pendingPayload ? (
          <p className="text-sm text-warm-700">
            This {editing ? 'changes' : 'adds'} the {rangeLabel(
              String(pendingPayload.fromAmount),
              pendingPayload.toAmount === null || pendingPayload.toAmount === undefined
                ? null
                : String(pendingPayload.toAmount),
            )}{' '}
            band of professional tax for <strong>{state}</strong>. It takes effect from the next
            payroll run; runs already computed are not recalculated.
          </p>
        ) : null}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirmSave()} loading={saving} disabled={saving}>
            Confirm &amp; save
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete professional tax band"
      >
        {deleteTarget ? (
          <p className="text-sm text-warm-700">
            Delete the {rangeLabel(deleteTarget.fromAmount, deleteTarget.toAmount)} band of
            professional tax for <strong>{state}</strong>? This takes effect from the next payroll
            run, which will no longer deduct professional tax for this range; runs already
            computed are not recalculated.
          </p>
        ) : null}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleDelete()}
            loading={deleting}
            disabled={deleting}
          >
            Delete band
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Income tax ladder
// ---------------------------------------------------------------------------

interface BandDraft {
  fromAmount: string;
  toAmount: string;
  openEnded: boolean;
  rate: string;
}

interface ItParamsDraft {
  standardDeduction: string;
  rebateIncomeLimit: string;
  rebateMaxAmount: string;
  cessRate: string;
  section80CLimit: string;
  section80DLimit: string;
  section80CCD1BLimit: string;
  childrenEducationMonthlyLimit: string;
  hostelAllowanceMonthlyLimit: string;
  childrenAllowanceMaxChildren: string;
  marginalReliefEnabled: boolean;
}

const DEFAULT_IT_PARAMS: ItParamsDraft = {
  standardDeduction: '75000',
  rebateIncomeLimit: '700000',
  rebateMaxAmount: '25000',
  cessRate: '4',
  section80CLimit: '150000',
  section80DLimit: '25000',
  section80CCD1BLimit: '50000',
  childrenEducationMonthlyLimit: '100',
  hostelAllowanceMonthlyLimit: '300',
  childrenAllowanceMaxChildren: '2',
  marginalReliefEnabled: true,
};

const DEFAULT_BANDS: BandDraft[] = [{ fromAmount: '0', toAmount: '', openEnded: true, rate: '0' }];

function paramsDraftFrom(config: IncomeTaxConfig): ItParamsDraft {
  return {
    standardDeduction: config.standardDeduction,
    rebateIncomeLimit: config.rebateIncomeLimit,
    rebateMaxAmount: config.rebateMaxAmount,
    cessRate: config.cessRate,
    section80CLimit: config.section80CLimit,
    section80DLimit: config.section80DLimit,
    section80CCD1BLimit: config.section80CCD1BLimit,
    childrenEducationMonthlyLimit: config.childrenEducationMonthlyLimit,
    hostelAllowanceMonthlyLimit: config.hostelAllowanceMonthlyLimit,
    childrenAllowanceMaxChildren: String(config.childrenAllowanceMaxChildren),
    marginalReliefEnabled: config.marginalReliefEnabled,
  };
}

function bandsDraftFrom(config: IncomeTaxConfig): BandDraft[] {
  return config.slabs.map((slab) => ({
    fromAmount: slab.fromAmount,
    toAmount: slab.toAmount ?? '',
    openEnded: slab.toAmount === null,
    rate: slab.rate,
  }));
}

const PARAM_FIELDS: { key: keyof ItParamsDraft; label: string; kind: 'amount' | 'percent' | 'count' }[] = [
  { key: 'standardDeduction', label: 'Standard deduction (₹)', kind: 'amount' },
  { key: 'rebateIncomeLimit', label: 'Section 87A rebate limit (₹)', kind: 'amount' },
  { key: 'rebateMaxAmount', label: 'Section 87A rebate amount (₹)', kind: 'amount' },
  { key: 'cessRate', label: 'Health and education cess (%)', kind: 'percent' },
  { key: 'section80CLimit', label: 'Section 80C limit (₹)', kind: 'amount' },
  { key: 'section80DLimit', label: 'Section 80D limit (₹)', kind: 'amount' },
  { key: 'section80CCD1BLimit', label: 'Section 80CCD(1B) limit (₹)', kind: 'amount' },
  {
    key: 'childrenEducationMonthlyLimit',
    label: "Children's education monthly limit (₹)",
    kind: 'amount',
  },
  { key: 'hostelAllowanceMonthlyLimit', label: 'Hostel allowance monthly limit (₹)', kind: 'amount' },
  { key: 'childrenAllowanceMaxChildren', label: 'Max children for the allowance', kind: 'count' },
];

function IncomeTaxSection() {
  const [year, setYear] = useState<number>(() => currentFinancialYear());
  const [regime, setRegime] = useState<TaxRegimeName>('OLD');
  const [ageBand, setAgeBand] = useState<AgeBand>('GENERAL');
  const effectiveAgeBand: AgeBand = regime === 'NEW' ? 'GENERAL' : ageBand;

  const [configs, setConfigs] = useState<IncomeTaxConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const [existingId, setExistingId] = useState<string | null>(null);
  const [params, setParams] = useState<ItParamsDraft>(DEFAULT_IT_PARAMS);
  const [bands, setBands] = useState<BandDraft[]>(DEFAULT_BANDS);
  const [paramErrors, setParamErrors] = useState<Partial<Record<keyof ItParamsDraft, string>>>({});
  const [bandErrors, setBandErrors] = useState<Record<number, string>>({});
  const [ladderError, setLadderError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await slabsApi.listIncomeTax(year);
      setConfigs((response?.data ?? []) as IncomeTaxConfig[]);
    } catch {
      setConfigs([]);
      toast.error('Income tax configurations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  // Which saved configuration, if any, matches the year/regime/age band in
  // view. Recomputed from the year's already-loaded list rather than a fresh
  // request, since switching regime or age band never changes the year.
  useEffect(() => {
    const match = configs.find(
      (config) =>
        config.financialYear === year &&
        config.regime === regime &&
        config.ageBand === effectiveAgeBand,
    );
    setBandErrors({});
    setLadderError(null);
    if (match) {
      setExistingId(match.id);
      setParams(paramsDraftFrom(match));
      setBands(bandsDraftFrom(match));
    } else {
      setExistingId(null);
      setParams(DEFAULT_IT_PARAMS);
      setBands(DEFAULT_BANDS);
    }
  }, [configs, year, regime, effectiveAgeBand]);

  const handleRegimeChange = (value: TaxRegimeName) => {
    setRegime(value);
    if (value === 'NEW') setAgeBand('GENERAL');
  };

  const setParamField = <K extends keyof ItParamsDraft>(key: K, value: ItParamsDraft[K]) => {
    setParams((current) => ({ ...current, [key]: value }));
    setParamErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const setBandField = <K extends keyof BandDraft>(index: number, key: K, value: BandDraft[K]) => {
    setBands((current) =>
      current.map((band, i) => (i === index ? { ...band, [key]: value } : band)),
    );
    setBandErrors((current) => {
      if (!(index in current)) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
  };

  const addBand = () => {
    setBands((current) => {
      const last = current[current.length - 1];
      return [
        ...current,
        { fromAmount: last ? last.toAmount : '', toAmount: '', openEnded: true, rate: '' },
      ];
    });
  };

  /**
   * A ladder starts at zero, and the first row's lower bound is not editable
   * for that reason. So whatever removal or reorder leaves at index nought has
   * to be pinned back to zero, or the row sits at some other amount with a
   * disabled input and no way for anyone to correct it.
   */
  const pinLowestBandToZero = (rows: BandDraft[]): BandDraft[] =>
    rows.length === 0 || rows[0].fromAmount === '0'
      ? rows
      : [{ ...rows[0], fromAmount: '0' }, ...rows.slice(1)];

  const removeBand = (index: number) => {
    setBands((current) =>
      current.length <= 1
        ? current
        : pinLowestBandToZero(current.filter((_, i) => i !== index)),
    );
  };

  const moveBand = (index: number, direction: -1 | 1) => {
    setBands((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return pinLowestBandToZero(next);
    });
  };

  const validate = (): boolean => {
    const nextParamErrors: Partial<Record<keyof ItParamsDraft, string>> = {};
    for (const field of PARAM_FIELDS) {
      const message = validateNumeric(params[field.key] as string, field.label, field.kind);
      if (message) nextParamErrors[field.key] = message;
    }

    const nextBandErrors: Record<number, string> = {};
    bands.forEach((band, index) => {
      const label = `Band ${index + 1}`;
      const fromError = validateNumeric(band.fromAmount, `${label} from`, 'amount');
      if (fromError) {
        nextBandErrors[index] = fromError;
        return;
      }
      if (!band.openEnded) {
        const toError = validateNumeric(band.toAmount, `${label} to`, 'amount');
        if (toError) {
          nextBandErrors[index] = toError;
          return;
        }
      }
      const rateError = validateNumeric(band.rate, `${label} rate`, 'percent');
      if (rateError) nextBandErrors[index] = rateError;
    });

    setParamErrors(nextParamErrors);
    setBandErrors(nextBandErrors);
    setLadderError(null);

    if (Object.keys(nextParamErrors).length > 0) {
      toast.error(Object.values(nextParamErrors)[0] as string);
      return false;
    }
    if (Object.keys(nextBandErrors).length > 0) {
      toast.error(Object.values(nextBandErrors)[0] as string);
      return false;
    }
    return true;
  };

  const handleSaveClick = () => {
    if (!validate()) return;
    setConfirmOpen(true);
  };

  const buildPayload = (): IncomeTaxConfigPayload => ({
    financialYear: year,
    regime,
    ageBand: effectiveAgeBand,
    standardDeduction: Number(params.standardDeduction),
    rebateIncomeLimit: Number(params.rebateIncomeLimit),
    rebateMaxAmount: Number(params.rebateMaxAmount),
    cessRate: Number(params.cessRate),
    section80CLimit: Number(params.section80CLimit),
    section80DLimit: Number(params.section80DLimit),
    section80CCD1BLimit: Number(params.section80CCD1BLimit),
    childrenEducationMonthlyLimit: Number(params.childrenEducationMonthlyLimit),
    hostelAllowanceMonthlyLimit: Number(params.hostelAllowanceMonthlyLimit),
    childrenAllowanceMaxChildren: Number(params.childrenAllowanceMaxChildren),
    marginalReliefEnabled: params.marginalReliefEnabled,
    slabs: bands.map(
      (band): IncomeTaxSlabPayload => ({
        fromAmount: Number(band.fromAmount),
        toAmount: band.openEnded ? null : Number(band.toAmount),
        rate: Number(band.rate),
      }),
    ),
  });

  const handleConfirmSave = async () => {
    setSaving(true);
    try {
      const response = await slabsApi.saveIncomeTax(buildPayload());
      const saved = (response?.data ?? null) as IncomeTaxConfig | null;
      toast.success('Saved. It applies from the next payroll run.');
      setConfirmOpen(false);
      if (saved) {
        setExistingId(saved.id);
      }
      await load();
    } catch (error) {
      const message = extractErrorMessage(
        error,
        'The income tax ladder could not be saved. Nothing was changed.',
      );
      // The server names a band by the amount it starts at, so it needs the
      // ladder on screen to map that back to a row.
      const parsed = parseLadderError(message, bands);
      // Close the confirmation either way. Left open it sits over the very row
      // the message belongs to, hides it, and invites the reader to confirm
      // the same refusal again.
      setConfirmOpen(false);
      if (parsed.bandIndex !== null && parsed.bandIndex < bands.length) {
        setBandErrors((current) => ({ ...current, [parsed.bandIndex as number]: message }));
        toast.error(message);
      } else {
        setLadderError(message);
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingId) return;
    setDeleting(true);
    try {
      await slabsApi.deleteIncomeTax(existingId);
      toast.success('Deleted. It applies from the next payroll run.');
      setDeleteConfirmOpen(false);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'The configuration could not be deleted.'));
    } finally {
      setDeleting(false);
    }
  };

  const summary = `${financialYearLabel(year)}, ${
    REGIME_OPTIONS.find((option) => option.value === regime)?.label
  }, ${AGE_BAND_OPTIONS.find((option) => option.value === effectiveAgeBand)?.label} age band`;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-5 w-5 text-primary-600" aria-hidden="true" />
            Income tax ladder
          </CardTitle>
          <Badge variant={existingId ? 'success' : 'gray'}>
            {existingId ? 'Configured' : 'Not set up yet'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select
            label="Financial year"
            aria-label="Financial year"
            value={String(year)}
            onChange={(event) => setYear(Number(event.target.value))}
            options={yearOptions()}
          />
          <Select
            label="Regime"
            aria-label="Regime"
            value={regime}
            onChange={(event) => handleRegimeChange(event.target.value as TaxRegimeName)}
            options={REGIME_OPTIONS}
          />
          <div>
            <Select
              label="Age band"
              aria-label="Age band"
              value={effectiveAgeBand}
              disabled={regime === 'NEW'}
              onChange={(event) => setAgeBand(event.target.value as AgeBand)}
              options={AGE_BAND_OPTIONS}
            />
            {regime === 'NEW' ? (
              <p className="mt-1 text-xs text-warm-500">
                The new regime&apos;s basic exemption does not vary by age, so there is only one
                configuration for it. Offering separate senior and super-senior rows here would
                only invite them to drift apart.
              </p>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-warm-500">Loading…</p>
        ) : (
          <>
            {ladderError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-medium text-red-800">{ladderError}</p>
              </div>
            ) : null}

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-warm-900">Slab ladder</h3>
              {bands.map((band, index) => (
                <div
                  key={index}
                  data-testid={`band-row-${index}`}
                  className="space-y-2 rounded-lg border border-warm-200 p-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-start">
                    <Input
                      label={`Band ${index + 1} from (₹)`}
                      aria-label={`Band ${index + 1} from (₹)`}
                      type="text"
                      inputMode="decimal"
                      value={band.fromAmount}
                      disabled={index === 0}
                      onChange={(event) => setBandField(index, 'fromAmount', event.target.value)}
                    />
                    <div>
                      <Input
                        label={`Band ${index + 1} to (₹)`}
                        aria-label={`Band ${index + 1} to (₹)`}
                        type="text"
                        inputMode="decimal"
                        value={band.toAmount}
                        disabled={band.openEnded}
                        onChange={(event) => setBandField(index, 'toAmount', event.target.value)}
                      />
                      <label className="mt-1.5 flex items-center gap-2 text-xs text-warm-600">
                        <input
                          type="checkbox"
                          aria-label={`Band ${index + 1} has no upper bound`}
                          checked={band.openEnded}
                          onChange={(event) =>
                            setBandField(index, 'openEnded', event.target.checked)
                          }
                        />
                        No upper bound
                      </label>
                    </div>
                    <Input
                      label={`Band ${index + 1} rate (%)`}
                      aria-label={`Band ${index + 1} rate (%)`}
                      type="text"
                      inputMode="decimal"
                      value={band.rate}
                      onChange={(event) => setBandField(index, 'rate', event.target.value)}
                    />
                    <div className="flex items-end gap-1">
                      <button
                        type="button"
                        aria-label={`Move band ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => moveBand(index, -1)}
                        className="rounded-lg p-1.5 text-warm-400 hover:bg-warm-100 hover:text-warm-700 disabled:opacity-30"
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move band ${index + 1} down`}
                        disabled={index === bands.length - 1}
                        onClick={() => moveBand(index, 1)}
                        className="rounded-lg p-1.5 text-warm-400 hover:bg-warm-100 hover:text-warm-700 disabled:opacity-30"
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove band ${index + 1}`}
                        disabled={bands.length <= 1}
                        onClick={() => removeBand(index)}
                        className="rounded-lg p-1.5 text-warm-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {bandErrors[index] ? (
                    <p className="text-xs font-medium text-red-700">{bandErrors[index]}</p>
                  ) : null}
                  {index > 0 ? (
                    <p className="text-xs text-warm-500">
                      {rangeLabel(band.fromAmount || '0', band.openEnded ? null : band.toAmount)},{' '}
                      {formatPercent(band.rate || '0')}
                    </p>
                  ) : null}
                </div>
              ))}
              <Button variant="secondary" onClick={addBand}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add income tax band
              </Button>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-warm-900">Other parameters</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {PARAM_FIELDS.map((field) => (
                  <Input
                    key={field.key}
                    label={field.label}
                    aria-label={field.label}
                    type="text"
                    inputMode="decimal"
                    value={params[field.key] as string}
                    error={paramErrors[field.key]}
                    onChange={(event) => setParamField(field.key, event.target.value)}
                  />
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-warm-700">
                <input
                  type="checkbox"
                  aria-label="Marginal relief enabled"
                  checked={params.marginalReliefEnabled}
                  onChange={(event) =>
                    setParamField('marginalReliefEnabled', event.target.checked)
                  }
                />
                Marginal relief enabled
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-warm-100 pt-4">
              <p className="text-xs text-warm-500">
                Replaces the whole ladder for {summary}. Takes effect from the next payroll run.
              </p>
              <div className="flex gap-3">
                {existingId ? (
                  <Button variant="danger" onClick={() => setDeleteConfirmOpen(true)}>
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Delete configuration
                  </Button>
                ) : null}
                <Button onClick={handleSaveClick}>
                  <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                  Save ladder
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm income tax ladder change"
      >
        <p className="text-sm text-warm-700">
          This replaces the whole income tax ladder for <strong>{summary}</strong>. It takes
          effect from the next payroll run; runs already computed are not recalculated.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirmSave()} loading={saving} disabled={saving}>
            Confirm &amp; save
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete income tax configuration"
      >
        <p className="text-sm text-warm-700">
          Delete the income tax configuration for <strong>{summary}</strong>? This takes effect
          from the next payroll run, which will fall back to whatever configuration, if any,
          otherwise applies; runs already computed are not recalculated.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleDelete()}
            loading={deleting}
            disabled={deleting}
          >
            Delete configuration
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminSlabsPage() {
  return (
    <div className="space-y-6 pb-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-warm-900">
          <Landmark className="h-7 w-7 text-primary-600" aria-hidden="true" />
          Tax slabs
        </h1>
        <p className="mt-1 text-warm-600">
          The professional tax and income tax figures every payslip&apos;s deduction is computed
          from.
        </p>
      </div>

      <EffectiveNotice />

      <ProfessionalTaxSection />
      <IncomeTaxSection />
    </div>
  );
}
