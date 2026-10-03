'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { peerApi, type PeerRequest } from '@/lib/api-performance-peer';
import type { AnswerInput } from '@/lib/api-performance-reviews';
import { QuestionAnswersForm, answersComplete, cleanAnswers } from '@/components/performance/reviews/QuestionAnswersForm';
import { AnswersReadonly } from '@/components/performance/reviews/AnswersReadonly';
import toast from 'react-hot-toast';
import { MessageSquare, RefreshCw } from 'lucide-react';

const COMMENT_MAX = 5000;

function errorMessage(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}

const name = (r: PeerRequest) => `${r.reviewee.firstName} ${r.reviewee.lastName}`;

function Group({
  testId, title, requests, children,
}: {
  testId: string;
  title: string;
  requests: PeerRequest[];
  children: (r: PeerRequest) => React.ReactNode;
}) {
  return (
    <section data-testid={testId} className="space-y-2">
      <h2 className="text-sm font-semibold text-warm-700">{title} ({requests.length})</h2>
      {requests.length === 0 ? (
        <p className="text-sm text-warm-400">Nothing here</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-warm-100">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-warm-900">{name(r)}</p>
                    <p className="text-xs text-warm-500">{r.cycle.name}</p>
                  </div>
                  {children(r)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export default function FeedbackRequestsPage() {
  const [requests, setRequests] = useState<PeerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [active, setActive] = useState<PeerRequest | null>(null);
  const [answers, setAnswers] = useState<AnswerInput[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await peerApi.myRequests();
      setRequests(res.data);
    } catch {
      setLoadError(true);
      toast.error('Failed to load feedback requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isOpen = (r: PeerRequest) => r.status === 'APPROVED' && !r.closed;
  const open = requests.filter(isOpen);
  const submitted = requests.filter((r) => r.status === 'SUBMITTED');
  const closed = requests.filter((r) => !isOpen(r) && r.status !== 'SUBMITTED');

  const openRequest = (r: PeerRequest) => {
    setActive(r);
    setAnswers([]);
    setComment('');
  };

  const readonly = !!active && !isOpen(active);
  const complete =
    !!active &&
    answersComplete(active.questions, 'PEER', answers) &&
    comment.trim().length > 0 &&
    comment.length <= COMMENT_MAX;

  const submit = async () => {
    if (!active || !complete) return;
    setSubmitting(true);
    try {
      await peerApi.submit(active.id, { answers: cleanAnswers(answers), overallComment: comment.trim() });
      toast.success('Feedback submitted');
      setActive(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to submit feedback'));
    } finally {
      setSubmitting(false);
    }
  };

  const decline = async () => {
    if (!active) return;
    setSubmitting(true);
    try {
      await peerApi.decline(active.id);
      toast.success('Request declined');
      setConfirmDecline(false);
      setActive(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to decline request'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Feedback Requests</h1>
            <p className="text-sm text-warm-500">Give feedback to colleagues who nominated you</p>
          </div>
        </div>
        <Button variant="secondary" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
        </div>
      ) : loadError ? (
        <Card>
          <CardContent className="text-center py-12 space-y-3">
            <p role="alert" className="text-sm text-red-600">Failed to load feedback requests.</p>
            <Button variant="secondary" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-warm-500">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 text-warm-300" />
            <p className="text-lg font-medium">No feedback requests</p>
            <p className="text-sm">You will see requests here when a colleague&apos;s peer list includes you</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Group testId="group-open" title="Open" requests={open}>
            {(r) => (
              <Button variant="primary" aria-label={`Give feedback for ${name(r)}`} onClick={() => openRequest(r)}>
                Give feedback
              </Button>
            )}
          </Group>
          <Group testId="group-submitted" title="Submitted" requests={submitted}>
            {(r) => (
              <div className="flex items-center gap-3">
                <Badge variant="success">Submitted</Badge>
                <Button variant="secondary" aria-label={`View feedback for ${name(r)}`} onClick={() => openRequest(r)}>
                  View
                </Button>
              </div>
            )}
          </Group>
          <Group testId="group-closed" title="Closed or declined" requests={closed}>
            {(r) => <Badge variant="gray">{r.status === 'DECLINED' ? 'Declined' : 'Closed'}</Badge>}
          </Group>
        </div>
      )}

      <Modal
        isOpen={!!active}
        onClose={() => setActive(null)}
        title={active ? `Feedback for ${name(active)} - ${active.cycle.name}` : ''}
        size="lg"
      >
        {active && (
          <div className="space-y-4">
            {readonly ? (
              <>
                <AnswersReadonly questions={active.questions} answers={active.answers} audience="PEER" />
                {active.overallComment && (
                  <div>
                    <p className="text-xs text-warm-500">Overall comment</p>
                    <p className="text-sm text-warm-700 bg-warm-50 p-3 rounded whitespace-pre-wrap">{active.overallComment}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-warm-500">
                  Your answers are shared with the reviewer by name. {name(active)} only sees anonymous, combined feedback.
                </p>
                <QuestionAnswersForm
                  questions={active.questions}
                  audience="PEER"
                  value={answers}
                  onChange={(a) => setAnswers(a)}
                  disabled={submitting}
                />
                <div>
                  <label htmlFor="peer-overall" className="block text-sm font-medium text-warm-700 mb-1">
                    Overall comment
                  </label>
                  <textarea
                    id="peer-overall"
                    rows={4}
                    maxLength={COMMENT_MAX}
                    value={comment}
                    disabled={submitting}
                    onChange={(e) => setComment(e.target.value)}
                    className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </>
            )}
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setActive(null)} disabled={submitting}>
            Close
          </Button>
          {active && !readonly && (
            <>
              <Button variant="danger" onClick={() => setConfirmDecline(true)} disabled={submitting}>
                Decline
              </Button>
              <Button variant="primary" onClick={submit} disabled={submitting || !complete}>
                {submitting ? 'Submitting...' : 'Submit feedback'}
              </Button>
            </>
          )}
        </ModalFooter>
      </Modal>

      <Modal isOpen={confirmDecline} onClose={() => setConfirmDecline(false)} title="Decline Request">
        <p className="text-sm text-warm-600">
          Decline giving feedback{active ? ` for ${name(active)}` : ''}? You cannot undo this.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmDecline(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={decline} disabled={submitting}>
            Confirm decline
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
