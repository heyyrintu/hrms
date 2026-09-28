'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ActionItemList } from '@/components/one-on-ones/ActionItemList';
import {
  oneOnOnesApi,
  type ActionItem,
  type OneOnOneDetail,
  type OneOnOneStatus,
} from '@/lib/api-one-on-ones';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const statusVariants: Record<OneOnOneStatus, 'info' | 'success' | 'gray'> = {
  SCHEDULED: 'info',
  COMPLETED: 'success',
  CANCELLED: 'gray',
};

const formatWhen = (value: string) =>
  new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * One meeting: header with status actions, a shared agenda and notes editor,
 * the action item checklist, open items carried over from earlier meetings
 * with this same person, and a private note only its author ever sees.
 */
export default function OneOnOneDetailPage() {
  const params = useParams<{ id: string }>();
  const meetingId = params?.id as string;

  const [meeting, setMeeting] = useState<OneOnOneDetail | null>(null);
  const [openItems, setOpenItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [agenda, setAgenda] = useState('');
  const [sharedNotes, setSharedNotes] = useState('');
  const [privateNote, setPrivateNote] = useState('');

  const load = useCallback(async () => {
    if (!meetingId) return;
    setLoading(true);
    try {
      const res = await oneOnOnesApi.get(meetingId);
      const detail: OneOnOneDetail = res.data;
      setMeeting(detail);
      setAgenda(detail.agenda ?? '');
      setSharedNotes(detail.sharedNotes ?? '');
      setPrivateNote(detail.myPrivateNote ?? '');

      if (detail.counterpart) {
        const itemsRes = await oneOnOnesApi.openItems(detail.counterpart.id);
        setOpenItems((itemsRes.data ?? []).filter((item: ActionItem) => item.meetingId !== meetingId));
      } else {
        setOpenItems([]);
      }
    } catch {
      toast.error('Failed to load one-on-one');
      setMeeting(null);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (status: OneOnOneStatus) => {
    setBusy(true);
    try {
      await oneOnOnesApi.update(meetingId, { status });
      toast.success(status === 'COMPLETED' ? 'Marked as completed' : 'One-on-one cancelled');
      await load();
    } catch {
      toast.error('Failed to update status');
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    setBusy(true);
    try {
      await oneOnOnesApi.update(meetingId, { agenda, sharedNotes });
      toast.success('Saved');
      await load();
    } catch {
      toast.error('Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const savePrivateNote = async () => {
    setBusy(true);
    try {
      await oneOnOnesApi.savePrivateNote(meetingId, privateNote);
      toast.success('Private note saved');
      await load();
    } catch {
      toast.error('Failed to save private note');
    } finally {
      setBusy(false);
    }
  };

  const addItem = async (data: { text: string; assigneeId: string; dueDate?: string }) => {
    setBusy(true);
    try {
      await oneOnOnesApi.addItem(meetingId, data);
      await load();
    } catch {
      toast.error('Failed to add action item');
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = async (item: ActionItem) => {
    setBusy(true);
    try {
      await oneOnOnesApi.updateItem(item.meetingId, item.id, { isDone: !item.isDone });
      await load();
    } catch {
      toast.error('Failed to update action item');
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (itemId: string) => {
    setBusy(true);
    try {
      await oneOnOnesApi.removeItem(meetingId, itemId);
      await load();
    } catch {
      toast.error('Failed to remove action item');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-warm-600">Loading one-on-one...</p>;
  }

  if (!meeting) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-warm-600">This one-on-one could not be loaded.</p>
        <Link href="/one-on-ones">Back to one-on-ones</Link>
      </div>
    );
  }

  const counterpartName = meeting.counterpart
    ? `${meeting.counterpart.firstName} ${meeting.counterpart.lastName}`
    : 'Unknown';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/one-on-ones" className="text-sm text-warm-600 flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to one-on-ones
          </Link>
          <h1 className="text-2xl font-semibold text-warm-900">{counterpartName}</h1>
          <p className="text-sm text-warm-600">{formatWhen(meeting.scheduledAt)}</p>
        </div>
        <Button variant="secondary" onClick={load} aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariants[meeting.status]}>{meeting.status}</Badge>
            <Badge variant="gray">{meeting.myRole === 'MANAGER' ? 'You are the manager' : 'You are the report'}</Badge>
          </div>
          {meeting.status === 'SCHEDULED' && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => changeStatus('COMPLETED')}>
                Complete
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => changeStatus('CANCELLED')}>
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="agenda" className="block text-sm font-medium text-warm-700 mb-1.5">
              Agenda
            </label>
            <textarea
              id="agenda"
              className="w-full rounded-lg border border-warm-300 p-3 text-sm"
              rows={3}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="shared-notes" className="block text-sm font-medium text-warm-700 mb-1.5">
              Shared notes
            </label>
            <textarea
              id="shared-notes"
              className="w-full rounded-lg border border-warm-300 p-3 text-sm"
              rows={5}
              value={sharedNotes}
              onChange={(e) => setSharedNotes(e.target.value)}
            />
          </div>
          <Button onClick={saveNotes} disabled={busy}>
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="text-sm font-medium text-warm-700 mb-2">Action items</h2>
          <ActionItemList
            items={meeting.actionItems}
            meId={meeting.myRole === 'MANAGER' ? meeting.managerId : meeting.employeeId}
            counterpartId={meeting.counterpart?.id ?? ''}
            counterpartName={counterpartName}
            busy={busy}
            onAdd={addItem}
            onToggle={toggleItem}
            onRemove={removeItem}
          />
        </CardContent>
      </Card>

      {openItems.length > 0 && (
        <Card>
          <CardContent>
            <h2 className="text-sm font-medium text-warm-700 mb-2">
              Open items from earlier one-on-ones
            </h2>
            <ul className="space-y-2">
              {openItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-warm-200 p-2.5"
                >
                  <input
                    type="checkbox"
                    aria-label={`Mark "${item.text}" done`}
                    checked={item.isDone}
                    disabled={busy}
                    onChange={() => toggleItem(item)}
                  />
                  <span className="text-sm text-warm-800">{item.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3">
          <label htmlFor="private-note" className="block text-sm font-medium text-warm-700">
            Private note — only you can see this
          </label>
          <textarea
            id="private-note"
            className="w-full rounded-lg border border-warm-300 p-3 text-sm"
            rows={4}
            value={privateNote}
            onChange={(e) => setPrivateNote(e.target.value)}
          />
          <Button onClick={savePrivateNote} disabled={busy}>
            Save private note
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
