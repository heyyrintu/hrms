'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Briefcase, Plus, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { FormGrid, FormRow } from '@/components/ui/FormRow';
import { Table, TableBody, TableCell, TableEmptyState, TableHead, TableHeader, TableLoadingState, TableRow } from '@/components/ui/Table';
import { departmentsApi, designationsApi } from '@/lib/api';
import { recruitmentApi, type JobOpening, type JobOpeningPayload, type JobOpeningStatus } from '@/lib/api-recruitment';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

const STATUS_COLORS: Record<JobOpeningStatus, BadgeVariant> = {
  DRAFT: 'gray',
  OPEN: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'danger',
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'OPEN', label: 'Open' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'CLOSED', label: 'Closed' },
];

const emptyForm = (): JobOpeningPayload => ({
  title: '',
  description: '',
  requirements: '',
  location: '',
  departmentId: '',
  designationId: '',
  positions: 1,
  isPublic: true,
  showSalary: false,
});

export default function JobOpeningsPage() {
  const { isAdmin } = useAuth();
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [designations, setDesignations] = useState<Array<{ id: string; name: string }>>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<JobOpeningPayload>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recruitmentApi.listOpenings(statusFilter ? { status: statusFilter as JobOpeningStatus } : undefined);
      setOpenings(res.data);
    } catch {
      toast.error('Failed to load job openings');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    departmentsApi
      .getAll()
      .then((res: any) => setDepartments(res.data?.data ?? res.data ?? []))
      .catch(() => {});
    designationsApi
      .getAll()
      .then((res: any) => setDesignations(res.data?.data ?? res.data ?? []))
      .catch(() => {});
  }, []);

  const openCreate = () => {
    setForm(emptyForm());
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Title and description are required');
      return;
    }
    setSaving(true);
    try {
      await recruitmentApi.createOpening({
        ...form,
        departmentId: form.departmentId || null,
        designationId: form.designationId || null,
      });
      toast.success('Job opening created');
      setFormOpen(false);
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to create the opening');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
              <Briefcase className="h-6 w-6 text-primary-600" />
              Job Openings
            </h1>
            <p className="mt-1 text-warm-600">Positions open across the organization</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={STATUS_OPTIONS}
              className="w-44"
            />
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            {isAdmin && (
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                New Opening
              </Button>
            )}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Positions</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingState colSpan={5} />
            ) : openings.length === 0 ? (
              <TableEmptyState message="No job openings found" colSpan={5} />
            ) : (
              openings.map((opening) => (
                <TableRow key={opening.id}>
                  <TableCell>
                    <Link href={`/recruitment/openings/${opening.id}`} className="font-medium text-primary-700 hover:underline">
                      {opening.title}
                    </Link>
                    <p className="text-xs text-warm-500">/{opening.slug}</p>
                  </TableCell>
                  <TableCell>{opening.department?.name ?? '-'}</TableCell>
                  <TableCell>{opening.positions}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLORS[opening.status]}>{opening.status.replace('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell>
                    {opening.publishedAt ? new Date(opening.publishedAt).toLocaleDateString() : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="New Job Opening" size="lg">
        <FormGrid cols={2}>
          <FormRow label="Title" required colSpan={2}>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </FormRow>
          <FormRow label="Description" required colSpan={2}>
            <textarea
              className="input min-h-[100px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormRow>
          <FormRow label="Department">
            <Select
              value={form.departmentId ?? ''}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
              options={[{ value: '', label: 'None' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
            />
          </FormRow>
          <FormRow label="Designation">
            <Select
              value={form.designationId ?? ''}
              onChange={(e) => setForm({ ...form, designationId: e.target.value })}
              options={[{ value: '', label: 'None' }, ...designations.map((d) => ({ value: d.id, label: d.name }))]}
            />
          </FormRow>
          <FormRow label="Location">
            <Input value={form.location ?? ''} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </FormRow>
          <FormRow label="Positions">
            <Input
              type="number"
              min={1}
              value={form.positions ?? 1}
              onChange={(e) => setForm({ ...form, positions: Number(e.target.value) })}
            />
          </FormRow>
        </FormGrid>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setFormOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Creating...' : 'Create Opening'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
