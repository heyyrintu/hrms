'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { recruitmentApi, type Interview } from '@/lib/api-recruitment';
import { ScheduleInterviewModal } from './ScheduleInterviewModal';
import { FeedbackFormModal } from './FeedbackFormModal';
import { FeedbackList } from './FeedbackList';
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_STATUS_VARIANTS,
  apiErrorMessage,
  formatDateTime,
} from '../offers/offerFormat';

interface Props {
  applicationId: string;
  applicationActive: boolean;
  /** The viewer may schedule / change interviews (HR, or the hiring manager). */
  canManage: boolean;
}

/** Interviews of one application, with panel feedback. */
export function InterviewPanel({ applicationId, applicationActive, canManage }: Props) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editing, setEditing] = useState<Interview | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<Interview | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await recruitmentApi.listInterviews(applicationId);
      setInterviews(res.data ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (interview: Interview, action: 'cancel' | 'complete' | 'noShow') => {
    if (action === 'cancel' && !window.confirm('Cancel this interview?')) return;
    setBusy(`${interview.id}:${action}`);
    try {
      if (action === 'cancel') await recruitmentApi.cancelInterview(interview.id);
      if (action === 'complete') await recruitmentApi.completeInterview(interview.id);
      if (action === 'noShow') await recruitmentApi.markInterviewNoShow(interview.id);
      toast.success('Interview updated');
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Action failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-warm-900">Interviews</h2>
          {canManage && applicationActive && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setScheduleOpen(true);
              }}
            >
              Schedule interview
            </Button>
          )}
        </div>

        {loading && <p className="text-sm text-warm-500">Loading interviews…</p>}
        {error && (
          <div className="flex items-center gap-3 text-sm text-red-600">
            Failed to load interviews.
            <Button size="sm" variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        {!loading && !error && interviews.length === 0 && (
          <p className="text-sm text-warm-500">No interviews scheduled.</p>
        )}

        {interviews.map((iv) => (
          <div key={iv.id} className="space-y-2 rounded-lg border border-warm-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-warm-900">{iv.roundName}</span>
                <Badge variant={INTERVIEW_STATUS_VARIANTS[iv.status]}>{INTERVIEW_STATUS_LABELS[iv.status]}</Badge>
              </div>
              <span className="text-sm text-warm-500">
                {formatDateTime(iv.scheduledStart)} · {INTERVIEW_MODE_LABELS[iv.mode]}
              </span>
            </div>
            <p className="text-sm text-warm-600">
              Panel:{' '}
              {iv.panel
                .map((p) => `${p.firstName} ${p.lastName}${iv.feedbackSubmittedBy.includes(p.id) ? ' ✓' : ''}`)
                .join(', ')}
            </p>
            {iv.meetingLink && <p className="break-all text-sm text-warm-600">Link: {iv.meetingLink}</p>}
            {iv.location && <p className="text-sm text-warm-600">Location: {iv.location}</p>}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded((e) => ({ ...e, [iv.id]: !e[iv.id] }))}
              >
                {expanded[iv.id] ? 'Hide feedback' : `Feedback (${iv.feedbackSubmittedBy.length})`}
              </Button>
              {iv.myFeedbackDue && (
                <Button size="sm" onClick={() => setFeedbackFor(iv)}>
                  Give feedback
                </Button>
              )}
              {canManage && iv.status === 'SCHEDULED' && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditing(iv);
                      setScheduleOpen(true);
                    }}
                  >
                    Reschedule
                  </Button>
                  <Button size="sm" variant="secondary" loading={busy === `${iv.id}:complete`} onClick={() => setStatus(iv, 'complete')}>
                    Mark completed
                  </Button>
                  <Button size="sm" variant="secondary" loading={busy === `${iv.id}:noShow`} onClick={() => setStatus(iv, 'noShow')}>
                    No-show
                  </Button>
                  <Button size="sm" variant="danger" loading={busy === `${iv.id}:cancel`} onClick={() => setStatus(iv, 'cancel')}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
            {expanded[iv.id] && <FeedbackList interviewId={iv.id} reloadKey={reloadKey} />}
          </div>
        ))}
      </CardContent>

      <ScheduleInterviewModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        applicationId={applicationId}
        interview={editing}
        onSaved={() => {
          setScheduleOpen(false);
          load();
        }}
      />
      {feedbackFor && (
        <FeedbackFormModal
          isOpen={!!feedbackFor}
          onClose={() => setFeedbackFor(null)}
          interview={feedbackFor}
          onSaved={() => {
            setFeedbackFor(null);
            setReloadKey((k) => k + 1);
            load();
          }}
        />
      )}
    </Card>
  );
}
