'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  helpdeskApi,
  isOverdue,
  priorityLabels,
  statusLabels,
  type TicketDetail,
  type TicketStatus,
} from '@/lib/api-helpdesk';
import { ArrowLeft, Lock, RefreshCw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const statusVariants: Record<TicketStatus, 'info' | 'warning' | 'success' | 'gray'> = {
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  WAITING_ON_EMPLOYEE: 'warning',
  RESOLVED: 'success',
  CLOSED: 'gray',
};

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

/**
 * One ticket and its thread.
 *
 * The buttons on offer come from the API's `allowedStatuses` rather than being
 * derived here, so the UI can never present a transition the server will
 * reject. Internal notes are already filtered server-side for the person who
 * raised the ticket; the lock badge is only ever seen by HR and the assignee.
 */
export default function HelpdeskTicketPage() {
  const params = useParams<{ id: string }>();
  const ticketId = params?.id as string;

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const res = await helpdeskApi.getTicket(ticketId);
      setTicket(res.data);
    } catch {
      toast.error('Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (status: TicketStatus) => {
    setBusy(true);
    try {
      await helpdeskApi.changeStatus(ticketId, status);
      toast.success(`Ticket moved to ${statusLabels[status]}`);
      await load();
    } catch {
      toast.error('Failed to change status');
    } finally {
      setBusy(false);
    }
  };

  const postComment = async () => {
    if (!comment.trim()) {
      toast.error('Write something first');
      return;
    }
    setBusy(true);
    try {
      await helpdeskApi.addComment(ticketId, comment.trim(), internal);
      setComment('');
      setInternal(false);
      await load();
    } catch {
      toast.error('Failed to add comment');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-warm-600">Loading ticket...</p>;
  }

  if (!ticket) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-warm-600">This ticket could not be loaded.</p>
        <Link href="/helpdesk">Back to helpdesk</Link>
      </div>
    );
  }

  const canPostInternal = ticket.actor !== 'OWNER';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/helpdesk" className="text-sm text-warm-600 flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to helpdesk
          </Link>
          <h1 className="text-2xl font-semibold text-warm-900">
            #{ticket.ticketNumber} {ticket.subject}
          </h1>
        </div>
        <Button variant="secondary" onClick={load} aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariants[ticket.status]}>
              {statusLabels[ticket.status]}
            </Badge>
            <Badge variant="gray">{priorityLabels[ticket.priority]}</Badge>
            {ticket.category && <Badge variant="info">{ticket.category.name}</Badge>}
            {isOverdue(ticket) && (
              <Badge variant="danger">
                <AlertTriangle className="h-3 w-3" />
                Overdue
              </Badge>
            )}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm text-warm-800">
            {ticket.description}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm text-warm-600">
            <div>
              <dt className="font-medium">Raised by</dt>
              <dd>
                {ticket.employee
                  ? `${ticket.employee.firstName} ${ticket.employee.lastName}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Assigned to</dt>
              <dd>{ticket.assignedTo?.email ?? 'Unassigned'}</dd>
            </div>
            <div>
              <dt className="font-medium">SLA deadline</dt>
              <dd>{formatDate(ticket.slaDeadline)}</dd>
            </div>
            <div>
              <dt className="font-medium">Resolved</dt>
              <dd>{formatDate(ticket.resolvedAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {ticket.allowedStatuses.length > 0 && (
        <Card>
          <CardContent>
            <h2 className="text-sm font-medium text-warm-700 mb-2">Move this ticket</h2>
            <div className="flex flex-wrap gap-2">
              {ticket.allowedStatuses.map((status) => (
                <Button
                  key={status}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => changeStatus(status)}
                >
                  {statusLabels[status]}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <h2 className="text-sm font-medium text-warm-700 mb-2">Conversation</h2>
          {ticket.comments.length === 0 ? (
            <p className="text-sm text-warm-600">No comments yet.</p>
          ) : (
            <ul className="space-y-3">
              {ticket.comments.map((c) => (
                <li
                  key={c.id}
                  className="rounded-lg border border-warm-200 p-3"
                  data-testid={c.isInternal ? 'internal-comment' : 'public-comment'}
                >
                  <div className="flex items-center gap-2 text-xs text-warm-500">
                    <span>{c.author?.email ?? 'Unknown'}</span>
                    <span>{formatDate(c.createdAt)}</span>
                    {c.isInternal && (
                      <Badge variant="warning">
                        <Lock className="h-3 w-3" />
                        Internal note
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-warm-800">
                    {c.content}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-2">
            <label
              htmlFor="new-comment"
              className="block text-sm font-medium text-warm-700"
            >
              Add a comment
            </label>
            <textarea
              id="new-comment"
              className="w-full rounded-lg border border-warm-300 p-3 text-sm"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {canPostInternal && (
              <label className="flex items-center gap-2 text-sm text-warm-700">
                <input
                  type="checkbox"
                  aria-label="Internal note"
                  checked={internal}
                  onChange={(e) => setInternal(e.target.checked)}
                />
                Internal note (hidden from the employee)
              </label>
            )}
            <Button onClick={postComment} disabled={busy}>
              Post comment
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
