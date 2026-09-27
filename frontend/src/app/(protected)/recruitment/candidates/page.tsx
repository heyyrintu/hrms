'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, Users2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { FormGrid, FormRow } from '@/components/ui/FormRow';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHead,
  TableHeader,
  TableLoadingState,
  TableRow,
} from '@/components/ui/Table';
import { api } from '@/lib/api';
import { recruitmentApi, type Candidate, type CandidatePayload } from '@/lib/api-recruitment';
import { cn } from '@/lib/utils';

const emptyForm = (): CandidatePayload => ({ firstName: '', lastName: '', email: '' });

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CandidatePayload>(emptyForm());
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (searchTerm?: string) => {
    setLoading(true);
    try {
      const res = await recruitmentApi.listCandidates(searchTerm ? { search: searchTerm } : undefined);
      setCandidates(res.data);
    } catch {
      toast.error('Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm(emptyForm());
    setResumeFile(null);
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      toast.error('First name, last name and email are required');
      return;
    }
    setSaving(true);
    try {
      let resumeUploadId: string | undefined;
      if (resumeFile) {
        const uploadForm = new FormData();
        uploadForm.append('file', resumeFile);
        uploadForm.append('entityType', 'CANDIDATE_RESUME');
        const uploadRes = await api.post('/uploads', uploadForm, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        resumeUploadId = uploadRes.data.id;
      }
      await recruitmentApi.createCandidate({ ...form, resumeUploadId });
      toast.success('Candidate added');
      setFormOpen(false);
      await load(search);
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string; existingCandidateId?: string } } };
      const data = axiosError.response?.data;
      toast.error(
        data?.existingCandidateId ? 'A candidate with this email already exists' : data?.message || 'Failed to add the candidate',
      );
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
              <Users2 className="h-6 w-6 text-primary-600" />
              Candidates
            </h1>
            <p className="mt-1 text-warm-600">Everyone who has applied or been referred</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                load(e.target.value);
              }}
              className="w-64"
            />
            <Button variant="secondary" onClick={() => load(search)} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              New Candidate
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Current title</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingState colSpan={5} />
            ) : candidates.length === 0 ? (
              <TableEmptyState message="No candidates found" colSpan={5} />
            ) : (
              candidates.map((candidate) => (
                <TableRow key={candidate.id} onClick={() => {}}>
                  <TableCell>
                    <Link href={`/recruitment/candidates/${candidate.id}`} className="font-medium text-primary-700 hover:underline">
                      {candidate.firstName} {candidate.lastName}
                    </Link>
                  </TableCell>
                  <TableCell>{candidate.email}</TableCell>
                  <TableCell>{candidate.currentTitle ?? '-'}</TableCell>
                  <TableCell>
                    <Badge variant="gray">{candidate.source.replace('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell>{new Date(candidate.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="New Candidate" size="lg">
        <FormGrid cols={2}>
          <FormRow label="First name" required>
            <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </FormRow>
          <FormRow label="Last name" required>
            <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </FormRow>
          <FormRow label="Email" required colSpan={2}>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormRow>
          <FormRow label="Phone">
            <Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </FormRow>
          <FormRow label="Current title">
            <Input value={form.currentTitle ?? ''} onChange={(e) => setForm({ ...form, currentTitle: e.target.value })} />
          </FormRow>
          <FormRow label="Current company">
            <Input value={form.currentCompany ?? ''} onChange={(e) => setForm({ ...form, currentCompany: e.target.value })} />
          </FormRow>
          <FormRow label="Resume">
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </FormRow>
        </FormGrid>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setFormOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : 'Add Candidate'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
