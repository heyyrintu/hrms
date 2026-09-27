'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  branchesApi,
  departmentsApi,
  designationsApi,
  employeesApi,
  lettersApi,
  payrollApi,
} from '@/lib/api';
import {
  recruitmentApi,
  type EmploymentType,
  type Offer,
  type OfferPayload,
} from '@/lib/api-recruitment';
import { apiErrorMessage } from './offerFormat';

interface Option {
  value: string;
  label: string;
}

/** Lists come back bare or wrapped in `{ data }` depending on the endpoint. */
function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const inner = (data as { data?: unknown })?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

const EMPLOYMENT_TYPES: Option[] = [
  { value: 'PERMANENT', label: 'Permanent' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'TEMPORARY', label: 'Temporary' },
  { value: 'INTERN', label: 'Intern' },
];

interface FormState {
  templateId: string;
  designationId: string;
  departmentId: string;
  branchId: string;
  reportingManagerId: string;
  employmentType: EmploymentType;
  annualCtc: string;
  monthlyBasePay: string;
  salaryStructureId: string;
  joiningDate: string;
  expiresAt: string;
}

function initialState(offer?: Offer | null): FormState {
  return {
    templateId: offer?.template.id ?? '',
    designationId: offer?.designation?.id ?? '',
    departmentId: offer?.department?.id ?? '',
    branchId: offer?.branch?.id ?? '',
    reportingManagerId: offer?.reportingManager?.id ?? '',
    employmentType: offer?.employmentType ?? 'PERMANENT',
    annualCtc: offer ? String(offer.annualCtc) : '',
    monthlyBasePay: offer?.monthlyBasePay != null ? String(offer.monthlyBasePay) : '',
    salaryStructureId: offer?.salaryStructure?.id ?? '',
    joiningDate: offer?.joiningDate ?? '',
    expiresAt: offer?.expiresAt ? offer.expiresAt.slice(0, 10) : '',
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  applicationId: string;
  /** Edit mode when set (DRAFT / REJECTED offers). */
  offer?: Offer | null;
  onSaved: (offer: Offer) => void;
}

/** Draft or edit an offer; the server renders the letter from the template. */
export function OfferFormModal({ isOpen, onClose, applicationId, offer, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(offer));
  const [saving, setSaving] = useState(false);
  const [refs, setRefs] = useState<{
    templates: Option[];
    designations: Option[];
    departments: Option[];
    branches: Option[];
    managers: Option[];
    structures: Option[];
  }>({ templates: [], designations: [], departments: [], branches: [], managers: [], structures: [] });

  useEffect(() => {
    if (isOpen) setForm(initialState(offer));
  }, [isOpen, offer]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const named = (rows: Array<{ id: string; name: string }>) => rows.map((r) => ({ value: r.id, label: r.name }));
    Promise.allSettled([
      lettersApi.getTemplates({ type: 'OFFER_LETTER' }),
      designationsApi.getAll(),
      departmentsApi.getAll(),
      branchesApi.getAll(),
      employeesApi.getAll({ status: 'ACTIVE', limit: 500 }),
      payrollApi.getStructures(),
    ]).then((results) => {
      if (cancelled) return;
      const data = (i: number) => (results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<{ data: unknown }>).value.data : []);
      const templates = asArray<{ id: string; name: string; type?: string; isActive?: boolean }>(data(0)).filter(
        (t) => (!t.type || t.type === 'OFFER_LETTER') && t.isActive !== false,
      );
      setRefs({
        templates: named(templates),
        designations: named(asArray(data(1))),
        departments: named(asArray(data(2))),
        branches: named(asArray(data(3))),
        managers: asArray<{ id: string; firstName: string; lastName: string; employeeCode?: string }>(data(4)).map((e) => ({
          value: e.id,
          label: `${e.firstName} ${e.lastName}${e.employeeCode ? ` (${e.employeeCode})` : ''}`,
        })),
        structures: named(asArray<{ id: string; name: string; isActive?: boolean }>(data(5)).filter((s) => s.isActive !== false)),
      });
      if (results[0].status === 'rejected') toast.error('Failed to load offer templates');
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.templateId) return toast.error('Choose an offer-letter template');
    const annualCtc = Number(form.annualCtc);
    if (!(annualCtc > 0)) return toast.error('Enter the annual CTC');
    if (!form.joiningDate) return toast.error('Enter the joining date');

    const payload: OfferPayload = {
      templateId: form.templateId,
      designationId: form.designationId || null,
      departmentId: form.departmentId || null,
      branchId: form.branchId || null,
      reportingManagerId: form.reportingManagerId || null,
      employmentType: form.employmentType,
      annualCtc,
      monthlyBasePay: form.monthlyBasePay ? Number(form.monthlyBasePay) : null,
      salaryStructureId: form.salaryStructureId || null,
      joiningDate: form.joiningDate,
      // End of the chosen day, local time.
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
    };

    setSaving(true);
    try {
      const res = offer
        ? await recruitmentApi.updateOffer(offer.id, payload)
        : await recruitmentApi.createOffer(applicationId, payload);
      toast.success(offer ? 'Offer updated' : 'Offer drafted');
      onSaved(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to save the offer'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={offer ? 'Edit offer' : 'Draft offer'} size="2xl">
      <form onSubmit={submit} className="space-y-4">
        <Select
          id="offer-template"
          label="Offer-letter template"
          placeholder="Select a template"
          options={refs.templates}
          value={form.templateId}
          onChange={(e) => set('templateId', e.target.value)}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            id="offer-designation"
            label="Designation"
            placeholder="—"
            options={refs.designations}
            value={form.designationId}
            onChange={(e) => set('designationId', e.target.value)}
          />
          <Select
            id="offer-department"
            label="Department"
            placeholder="—"
            options={refs.departments}
            value={form.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
          />
          <Select
            id="offer-branch"
            label="Branch"
            placeholder="—"
            options={refs.branches}
            value={form.branchId}
            onChange={(e) => set('branchId', e.target.value)}
          />
          <Select
            id="offer-manager"
            label="Reporting manager"
            placeholder="—"
            options={refs.managers}
            value={form.reportingManagerId}
            onChange={(e) => set('reportingManagerId', e.target.value)}
          />
          <Select
            id="offer-employment-type"
            label="Employment type"
            options={EMPLOYMENT_TYPES}
            value={form.employmentType}
            onChange={(e) => set('employmentType', e.target.value as EmploymentType)}
          />
          <Input
            label="Annual CTC (₹)"
            type="number"
            min={1}
            step="0.01"
            value={form.annualCtc}
            onChange={(e) => set('annualCtc', e.target.value)}
            required
          />
          <Select
            id="offer-structure"
            label="Salary structure"
            placeholder="—"
            options={refs.structures}
            value={form.salaryStructureId}
            onChange={(e) => set('salaryStructureId', e.target.value)}
          />
          <Input
            label="Monthly base pay (₹)"
            type="number"
            min={0}
            step="0.01"
            value={form.monthlyBasePay}
            onChange={(e) => set('monthlyBasePay', e.target.value)}
          />
          <Input
            label="Joining date"
            type="date"
            value={form.joiningDate}
            onChange={(e) => set('joiningDate', e.target.value)}
            required
          />
          <Input
            label="Respond by (optional)"
            type="date"
            value={form.expiresAt}
            onChange={(e) => set('expiresAt', e.target.value)}
          />
        </div>
        <p className="text-xs text-warm-500">
          The letter is rendered from the template when you save. Salary structure and base pay set up
          the employee&apos;s salary when the accepted offer is converted. Without a respond-by date the
          offer expires after the tenant&apos;s default window from when it is sent.
        </p>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {offer ? 'Save changes' : 'Save draft'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
