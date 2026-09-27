'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardSignature, Plus, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { FormGrid, FormRow } from '@/components/ui/FormRow';
import { ApprovalTrail } from '@/components/approvals/ApprovalTrail';
import { departmentsApi } from '@/lib/api';
import {
  recruitmentApi,
  type Requisition,
  type RequisitionPayload,
  type JobRequisitionStatus,
} from '@/lib/api-recruitment';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

const STATUS_COLORS: Record<JobRequisitionStatus, BadgeVariant> = {
  DRAFT: 'gray',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'gray',
  FILLED: 'info',
};

const EDITABLE: JobRequisitionStatus[] = ['DRAFT', 'REJECTED'];
const CANCELLABLE: JobRequisitionStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'];

const emptyForm = (): RequisitionPayload => ({ title: '', headcount: 1 });

export default function RequisitionsPage() {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RequisitionPayload>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [expandedTrail, setExpandedTrail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recruitmentApi.listRequisitions();
      setRequisitions(res.data);
    } catch {
      toast.error('Failed to load requisitions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    departmentsApi
      .getAll()
      .then((res: any) => setDepartments(res.data?.data ?? res.data ?? []))
      .catch(() => {});
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (req: Requisition) => {
    setEditingId(req.id);
    setForm({
      title: req.title,
      departmentId: req.department?.id ?? '',
      headcount: req.headcount,
      budgetMin: req.budgetMin ?? undefined,
      budgetMax: req.budgetMax ?? undefined,
      justification: req.justification ?? '',
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.title.trim() || form.headcount < 1) {
      toast.error('A title and a headcount of at least 1 are required');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await recruitmentApi.updateRequisition(editingId, form);
        toast.success('Requisition updated');
      } else {
        await recruitmentApi.createRequisition(form);
        toast.success('Requisition created');
      }
      setFormOpen(false);
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to save the requisition');
    } finally {
      setSaving(false);
    }
  };

  const submitRequisition = async (id: string) => {
    try {
      await recruitmentApi.submitRequisition(id);
      toast.success('Requisition submitted for approval');
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to submit the requisition');
    }
  };

  const cancelRequisition = async (id: string) => {
    try {
      await recruitmentApi.cancelRequisition(id);
      toast.success('Requisition cancelled');
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to cancel the requisition');
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
              <ClipboardSignature className="h-6 w-6 text-primary-600" />
              Job Requisitions
            </h1>
            <p className="mt-1 text-warm-600">Request headcount and track its approval</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              New Requisition
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : requisitions.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ClipboardSignature className="mx-auto mb-4 h-16 w-16 text-warm-300" />
              <p className="text-warm-600">No requisitions yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {requisitions.map((req) => (
              <Card key={req.id}>
                <CardContent className="py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-warm-900">{req.title}</span>
                        <Badge variant={STATUS_COLORS[req.status]}>{req.status.replace('_', ' ')}</Badge>
                      </div>
                      <p className="text-sm text-warm-500">
                        {req.department?.name ?? 'No department'} · {req.headcount} headcount ·
                        requested by {req.requestedBy.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {EDITABLE.includes(req.status) && (
                        <Button size="sm" variant="secondary" onClick={() => openEdit(req)}>
                          Edit
                        </Button>
                      )}
                      {EDITABLE.includes(req.status) && (
                        <Button size="sm" onClick={() => submitRequisition(req.id)}>
                          Submit
                        </Button>
                      )}
                      {CANCELLABLE.includes(req.status) && (
                        <Button size="sm" variant="ghost" onClick={() => cancelRequisition(req.id)}>
                          Cancel
                        </Button>
                      )}
                      {req.status !== 'DRAFT' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpandedTrail(expandedTrail === req.id ? null : req.id)}
                        >
                          {expandedTrail === req.id ? 'Hide trail' : 'View trail'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {expandedTrail === req.id && (
                    <ApprovalTrail entityType="JOB_REQUISITION" entityId={req.id} className="mt-3" />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Edit Requisition' : 'New Requisition'}
        size="lg"
      >
        <FormGrid cols={2}>
          <FormRow label="Title" required colSpan={2}>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </FormRow>
          <FormRow label="Department">
            <Select
              value={form.departmentId ?? ''}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              options={[{ value: '', label: 'None' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
            />
          </FormRow>
          <FormRow label="Headcount" required>
            <Input
              type="number"
              min={1}
              value={form.headcount}
              onChange={(e) => setForm({ ...form, headcount: Number(e.target.value) })}
            />
          </FormRow>
          <FormRow label="Budget min (annual CTC)">
            <Input
              type="number"
              value={form.budgetMin ?? ''}
              onChange={(e) => setForm({ ...form, budgetMin: e.target.value ? Number(e.target.value) : undefined })}
            />
          </FormRow>
          <FormRow label="Budget max (annual CTC)">
            <Input
              type="number"
              value={form.budgetMax ?? ''}
              onChange={(e) => setForm({ ...form, budgetMax: e.target.value ? Number(e.target.value) : undefined })}
            />
          </FormRow>
          <FormRow label="Justification" colSpan={2}>
            <textarea
              className="input min-h-[80px]"
              value={form.justification ?? ''}
              onChange={(e) => setForm({ ...form, justification: e.target.value })}
            />
          </FormRow>
        </FormGrid>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setFormOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : editingId ? 'Save changes' : 'Create Requisition'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
