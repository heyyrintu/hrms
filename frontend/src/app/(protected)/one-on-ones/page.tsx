'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { ScheduleOneOnOneModal } from '@/components/one-on-ones/ScheduleOneOnOneModal';
import {
  oneOnOnesApi,
  type Counterpart,
  type CreateOneOnOnePayload,
  type OneOnOne,
  type OneOnOneStatus,
} from '@/lib/api-one-on-ones';
import { Users, Plus, RefreshCw } from 'lucide-react';
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
 * My one-on-ones, grouped by whether they are still ahead of us or already
 * happened. Grouping is by `scheduledAt` against now, not by status, so a
 * meeting that slipped past its time without being marked COMPLETED still
 * reads as "past" rather than lingering in "upcoming".
 */
export default function OneOnOnesPage() {
  const [meetings, setMeetings] = useState<OneOnOne[]>([]);
  const [counterparts, setCounterparts] = useState<Counterpart[]>([]);
  const [filterCounterpartId, setFilterCounterpartId] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (counterpartId?: string) => {
    setLoading(true);
    try {
      const res = await oneOnOnesApi.list(counterpartId ? { counterpartId } : undefined);
      setMeetings(res.data ?? []);
    } catch {
      toast.error('Failed to load one-on-ones');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCounterparts = useCallback(async () => {
    try {
      const res = await oneOnOnesApi.counterparts();
      setCounterparts(res.data ?? []);
    } catch {
      setCounterparts([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadCounterparts();
  }, [load, loadCounterparts]);

  const onFilterChange = (value: string) => {
    setFilterCounterpartId(value);
    load(value || undefined);
  };

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const future = meetings
      .filter((m) => new Date(m.scheduledAt).getTime() >= now)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    const done = meetings.filter((m) => new Date(m.scheduledAt).getTime() < now);
    return { upcoming: future, past: done };
  }, [meetings]);

  const schedule = async (data: CreateOneOnOnePayload) => {
    setSaving(true);
    try {
      await oneOnOnesApi.create(data);
      toast.success('One-on-one scheduled');
      setModalOpen(false);
      await load(filterCounterpartId || undefined);
    } catch {
      toast.error('Failed to schedule one-on-one');
    } finally {
      setSaving(false);
    }
  };

  const renderGroup = (title: string, items: OneOnOne[], emptyText: string) => (
    <div>
      <h2 className="text-sm font-medium text-warm-700 mb-2">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-warm-600">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-warm-200">
          {items.map((meeting) => (
            <li key={meeting.id} className="py-3">
              <Link href={`/one-on-ones/${meeting.id}`} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-warm-900">
                  {meeting.counterpart
                    ? `${meeting.counterpart.firstName} ${meeting.counterpart.lastName}`
                    : 'Unknown'}
                </span>
                <span className="text-sm text-warm-600">{formatWhen(meeting.scheduledAt)}</span>
                <Badge variant={statusVariants[meeting.status]}>{meeting.status}</Badge>
                <Badge variant="gray">{meeting.myRole === 'MANAGER' ? 'You are the manager' : 'You are the report'}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 flex items-center gap-2">
            <Users className="h-6 w-6" />
            One-on-ones
          </h1>
          <p className="text-sm text-warm-600">
            Regular check-ins with your manager and direct reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => load(filterCounterpartId || undefined)} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Schedule one-on-one
          </Button>
        </div>
      </div>

      <Card padding="sm">
        <CardContent>
          <div className="max-w-xs">
            <Select
              label="Filter by counterpart"
              value={filterCounterpartId}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="All counterparts"
              options={counterparts.map((c) => ({
                value: c.id,
                label: `${c.firstName} ${c.lastName}`,
              }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {loading ? (
            <p className="text-sm text-warm-600">Loading one-on-ones...</p>
          ) : (
            <div className="space-y-6">
              {renderGroup('Upcoming', upcoming, 'No upcoming one-on-ones.')}
              {renderGroup('Past', past, 'No past one-on-ones yet.')}
            </div>
          )}
        </CardContent>
      </Card>

      <ScheduleOneOnOneModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        counterparts={counterparts}
        saving={saving}
        onSubmit={schedule}
      />
    </div>
  );
}
