'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/contexts/AuthContext';
import { currentEmployeeId } from '@/lib/current-employee';
import { UserRole } from '@/types';
import { recruitmentApi, type Interview, type InterviewFeedback } from '@/lib/api-recruitment';
import { FeedbackFormModal } from '@/components/recruitment/interviews/FeedbackFormModal';
import { FeedbackList } from '@/components/recruitment/interviews/FeedbackList';
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_STATUS_VARIANTS,
  formatDateTime,
} from '@/components/recruitment/offers/offerFormat';

type Tab = 'upcoming' | 'past';

/** Interviews the signed-in employee is on the panel of, and their scorecards. */
export default function MyInterviewsPage() {
  const { user, hasRole } = useAuth();
  const myEmployeeId = currentEmployeeId(user);
  const canOpenApplication = hasRole(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER);

  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [feedbackFor, setFeedbackFor] = useState<{ interview: Interview; existing: InterviewFeedback | null } | null>(
    null,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await recruitmentApi.myInterviews();
      setInterviews(res.data ?? []);
    } catch {
      setError(true);
      toast.error('Failed to load your interviews');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: Interview[] = [];
    const done: Interview[] = [];
    for (const iv of interviews) {
      if (iv.status === 'SCHEDULED' && new Date(iv.scheduledEnd).getTime() >= now) up.push(iv);
      else done.push(iv);
    }
    done.sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart));
    return { upcoming: up, past: done };
  }, [interviews]);

  const openFeedback = async (interview: Interview) => {
    const submitted = !!myEmployeeId && interview.feedbackSubmittedBy.includes(myEmployeeId);
    if (!submitted) {
      setFeedbackFor({ interview, existing: null });
      return;
    }
    try {
      const res = await recruitmentApi.getFeedback(interview.id);
      const mine = res.data.items.find((f) => f.interviewer.id === myEmployeeId) ?? null;
      setFeedbackFor({ interview, existing: mine });
    } catch {
      toast.error('Failed to load your feedback');
    }
  };

  const list = tab === 'upcoming' ? upcoming : past;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900">My interviews</h1>
          <p className="text-sm text-warm-500">Interviews you are on the panel of. Your scorecard is shared with HR and the hiring manager.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="flex gap-2" role="tablist">
        {(['upcoming', 'past'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === t ? 'bg-primary-600 text-white' : 'bg-warm-100 text-warm-700'
            }`}
          >
            {t === 'upcoming' ? `Upcoming (${upcoming.length})` : `Past (${past.length})`}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-warm-500">Loading interviews…</p>}
      {error && !loading && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          Could not load your interviews.
          <Button size="sm" variant="secondary" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && list.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-warm-500">
            {tab === 'upcoming' ? 'No upcoming interviews.' : 'No past interviews.'}
          </CardContent>
        </Card>
      )}

      {!loading &&
        !error &&
        list.map((iv) => {
          const submitted = !!myEmployeeId && iv.feedbackSubmittedBy.includes(myEmployeeId);
          return (
            <Card key={iv.id}>
              <CardContent className="space-y-2 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-warm-900">
                      {iv.candidate.firstName} {iv.candidate.lastName}
                    </p>
                    <p className="text-sm text-warm-600">
                      {iv.jobOpening.title} · {iv.roundName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {iv.myFeedbackDue && <Badge variant="warning">Feedback due</Badge>}
                    <Badge variant={INTERVIEW_STATUS_VARIANTS[iv.status]}>{INTERVIEW_STATUS_LABELS[iv.status]}</Badge>
                  </div>
                </div>
                <p className="text-sm text-warm-600">
                  {formatDateTime(iv.scheduledStart)} · {INTERVIEW_MODE_LABELS[iv.mode]}
                  {iv.location ? ` · ${iv.location}` : ''}
                </p>
                {iv.meetingLink && (
                  <p className="break-all text-sm">
                    <a href={iv.meetingLink} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">
                      {iv.meetingLink}
                    </a>
                  </p>
                )}
                {iv.notes && <p className="whitespace-pre-wrap text-sm text-warm-600">{iv.notes}</p>}
                <p className="text-sm text-warm-500">
                  Panel: {iv.panel.map((p) => `${p.firstName} ${p.lastName}`).join(', ')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(iv.myFeedbackDue || submitted) && iv.status !== 'CANCELLED' && iv.status !== 'NO_SHOW' && (
                    <Button size="sm" variant={submitted ? 'secondary' : 'primary'} onClick={() => openFeedback(iv)}>
                      {submitted ? 'Update feedback' : 'Give feedback'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => ({ ...e, [iv.id]: !e[iv.id] }))}>
                    {expanded[iv.id] ? 'Hide panel feedback' : 'Panel feedback'}
                  </Button>
                  {canOpenApplication && (
                    <Link href={`/recruitment/applications/${iv.applicationId}`} className="btn btn-ghost btn-sm">
                      Open application
                    </Link>
                  )}
                </div>
                {expanded[iv.id] && <FeedbackList interviewId={iv.id} reloadKey={reloadKey} />}
              </CardContent>
            </Card>
          );
        })}

      {feedbackFor && (
        <FeedbackFormModal
          isOpen={!!feedbackFor}
          onClose={() => setFeedbackFor(null)}
          interview={feedbackFor.interview}
          existing={feedbackFor.existing}
          onSaved={() => {
            setFeedbackFor(null);
            setReloadKey((k) => k + 1);
            load();
          }}
        />
      )}
    </div>
  );
}
