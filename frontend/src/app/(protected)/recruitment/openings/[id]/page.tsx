'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Briefcase, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { FormRow } from '@/components/ui/FormRow';
import { useAuth } from '@/contexts/AuthContext';
import {
  recruitmentApi,
  type ApplicationCard,
  type JobOpening,
  type PipelineStage,
} from '@/lib/api-recruitment';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

const OPENING_STATUS_COLORS: Record<JobOpening['status'], BadgeVariant> = {
  DRAFT: 'gray',
  OPEN: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'danger',
};

export default function OpeningDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { isAdmin } = useAuth();

  const [opening, setOpening] = useState<JobOpening | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [cards, setCards] = useState<ApplicationCard[]>([]);
  const [loading, setLoading] = useState(true);

  const [rejecting, setRejecting] = useState<ApplicationCard | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [openingRes, stagesRes, cardsRes] = await Promise.all([
        recruitmentApi.getOpening(id),
        recruitmentApi.listStages(),
        recruitmentApi.listOpeningApplications(id),
      ]);
      setOpening(openingRes.data);
      setStages(stagesRes.data);
      setCards(cardsRes.data);
    } catch {
      toast.error('Failed to load the opening');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(() => {
    const active = [...stages].filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
    return active.map((stage) => ({
      stage,
      cards: cards.filter((c) => c.stage.id === stage.id && c.status === 'ACTIVE'),
    }));
  }, [stages, cards]);

  const moveCard = async (card: ApplicationCard, stageId: string) => {
    setBusy(true);
    try {
      await recruitmentApi.moveApplication(card.id, { stageId });
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to move the application');
    } finally {
      setBusy(false);
    }
  };

  const confirmReject = async () => {
    if (!rejecting || !rejectReason.trim()) {
      toast.error('A rejection reason is required');
      return;
    }
    setBusy(true);
    try {
      await recruitmentApi.rejectApplication(rejecting.id, rejectReason.trim());
      toast.success('Application rejected');
      setRejecting(null);
      setRejectReason('');
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to reject the application');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (action: 'publish' | 'hold' | 'close') => {
    setBusy(true);
    try {
      if (action === 'publish') await recruitmentApi.publishOpening(id);
      if (action === 'hold') await recruitmentApi.holdOpening(id);
      if (action === 'close') await recruitmentApi.closeOpening(id);
      toast.success('Opening updated');
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to update the opening');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !opening) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!opening) return null;

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/recruitment" className="mb-1 flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to openings
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
              <Briefcase className="h-6 w-6 text-primary-600" />
              {opening.title}
              <Badge variant={OPENING_STATUS_COLORS[opening.status]}>{opening.status.replace('_', ' ')}</Badge>
            </h1>
            <p className="mt-1 text-warm-600">
              {opening.positions} position{opening.positions !== 1 ? 's' : ''} · {opening.department?.name ?? 'No department'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            {isAdmin && (opening.status === 'DRAFT' || opening.status === 'ON_HOLD') && (
              <Button onClick={() => changeStatus('publish')} disabled={busy}>
                Publish
              </Button>
            )}
            {isAdmin && opening.status === 'OPEN' && (
              <Button variant="secondary" onClick={() => changeStatus('hold')} disabled={busy}>
                Hold
              </Button>
            )}
            {isAdmin && opening.status !== 'CLOSED' && (
              <Button variant="ghost" onClick={() => changeStatus('close')} disabled={busy}>
                Close
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map(({ stage, cards: stageCards }) => (
            <div key={stage.id} className="min-w-[260px] flex-1">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-warm-700">{stage.name}</h3>
                <Badge variant="gray">{stageCards.length}</Badge>
              </div>
              <div className="space-y-2">
                {stageCards.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-warm-200 p-3 text-center text-xs text-warm-400">
                    No candidates
                  </p>
                ) : (
                  stageCards.map((card) => (
                    <Card key={card.id} padding="sm">
                      <CardContent className="space-y-2 p-0">
                        <Link
                          href={`/recruitment/applications/${card.id}`}
                          className="block text-sm font-medium text-primary-700 hover:underline"
                        >
                          {card.candidate.firstName} {card.candidate.lastName}
                        </Link>
                        <p className="text-xs text-warm-500">{card.candidate.currentTitle ?? card.candidate.email}</p>
                        <p className="text-xs text-warm-400">
                          Applied {new Date(card.appliedAt).toLocaleDateString()} · {card.interviewCount} interview
                          {card.interviewCount !== 1 ? 's' : ''}
                        </p>
                        <div className="flex items-center gap-2">
                          <Select
                            value=""
                            onChange={(e) => e.target.value && moveCard(card, e.target.value)}
                            options={[
                              { value: '', label: 'Move to...' },
                              ...stages
                                .filter((s) => s.isActive && s.id !== stage.id && s.category !== 'REJECTED')
                                .map((s) => ({ value: s.id, label: s.name })),
                            ]}
                            className="h-8 text-xs"
                            disabled={busy}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRejecting(card)}
                            className="text-red-600"
                          >
                            Reject
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal isOpen={!!rejecting} onClose={() => setRejecting(null)} title="Reject application">
        <FormRow label="Reason" required>
          <textarea
            className="input min-h-[80px]"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </FormRow>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRejecting(null)}>
            Cancel
          </Button>
          <Button onClick={confirmReject} disabled={busy}>
            Reject
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
