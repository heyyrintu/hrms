'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import {
  helpdeskApi,
  isOverdue,
  priorityLabels,
  statusLabels,
  type HelpdeskAgent,
  type HelpdeskStats,
  type Ticket,
  type TicketCategory,
  type TicketStatus,
} from '@/lib/api-helpdesk';
import { LifeBuoy, RefreshCw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const statusVariants: Record<TicketStatus, 'info' | 'warning' | 'success' | 'gray'> = {
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  WAITING_ON_EMPLOYEE: 'warning',
  RESOLVED: 'success',
  CLOSED: 'gray',
};

const statusOrder: TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_EMPLOYEE',
  'RESOLVED',
  'CLOSED',
];

/**
 * The HR queue. Filters, the stats strip, and per-row assignment; the full
 * thread and internal notes live on the ticket detail page, which HR reaches
 * through the same /helpdesk/:id route as everyone else.
 */
export default function AdminHelpdeskPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [agents, setAgents] = useState<HelpdeskAgent[]>([]);
  const [stats, setStats] = useState<HelpdeskStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [overdue, setOverdue] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await helpdeskApi.getTickets({
        status: (status || undefined) as TicketStatus | undefined,
        categoryId: categoryId || undefined,
        overdue: overdue || undefined,
      });
      setTickets(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load the queue');
    } finally {
      setLoading(false);
    }
  }, [status, categoryId, overdue]);

  const loadSidecars = useCallback(async () => {
    try {
      const [cats, people, s] = await Promise.all([
        helpdeskApi.getCategories(true),
        helpdeskApi.getAgents(),
        helpdeskApi.getStats(),
      ]);
      setCategories(cats.data ?? []);
      setAgents(people.data ?? []);
      setStats(s.data ?? null);
    } catch {
      toast.error('Failed to load helpdesk settings');
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    loadSidecars();
  }, [loadSidecars]);

  const assign = async (ticketId: string, assignedToId: string) => {
    if (!assignedToId) return;
    try {
      await helpdeskApi.assign(ticketId, assignedToId);
      toast.success('Ticket assigned');
      await loadTickets();
      await loadSidecars();
    } catch {
      toast.error('Failed to assign ticket');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 flex items-center gap-2">
            <LifeBuoy className="h-6 w-6" />
            Helpdesk queue
          </h1>
          <p className="text-sm text-warm-600">
            Every ticket in the tenant, with SLA state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/helpdesk/categories">Categories</Link>
          <Button variant="secondary" onClick={loadTickets} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          {stats ? (
            <div className="flex flex-wrap gap-4 text-sm">
              {statusOrder.map((s) => (
                <div key={s} data-testid={`stat-${s}`}>
                  <span className="text-warm-600">{statusLabels[s]}: </span>
                  <span className="font-semibold text-warm-900">
                    {stats.byStatus?.[s] ?? 0}
                  </span>
                </div>
              ))}
              <div data-testid="stat-overdue">
                <span className="text-warm-600">Overdue: </span>
                <span className="font-semibold text-red-600">{stats.overdue}</span>
              </div>
              <div data-testid="stat-avg">
                <span className="text-warm-600">Avg resolution: </span>
                <span className="font-semibold text-warm-900">
                  {stats.avgResolutionHours === null
                    ? 'n/a'
                    : `${stats.avgResolutionHours}h`}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-warm-600">Stats unavailable.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="All statuses"
              options={statusOrder.map((s) => ({ value: s, label: statusLabels[s] }))}
            />
            <Select
              label="Category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              placeholder="All categories"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <label className="flex items-center gap-2 text-sm text-warm-700">
              <input
                type="checkbox"
                aria-label="Overdue only"
                checked={overdue}
                onChange={(e) => setOverdue(e.target.checked)}
              />
              Overdue only
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {loading ? (
            <p className="text-sm text-warm-600">Loading queue...</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-warm-600">Nothing in the queue.</p>
          ) : (
            <ul className="divide-y divide-warm-200">
              {tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                  data-testid={`ticket-${ticket.id}`}
                >
                  <Link href={`/helpdesk/${ticket.id}`} className="font-medium">
                    #{ticket.ticketNumber} {ticket.subject}
                  </Link>
                  <Badge variant={statusVariants[ticket.status]}>
                    {statusLabels[ticket.status]}
                  </Badge>
                  <Badge variant="gray">{priorityLabels[ticket.priority]}</Badge>
                  <span className="text-sm text-warm-600">
                    {ticket.employee
                      ? `${ticket.employee.firstName} ${ticket.employee.lastName}`
                      : '—'}
                  </span>
                  {isOverdue(ticket) && (
                    <Badge variant="danger">
                      <AlertTriangle className="h-3 w-3" />
                      Overdue
                    </Badge>
                  )}
                  <Select
                    label={`Assign #${ticket.ticketNumber}`}
                    value={ticket.assignedToId ?? ''}
                    onChange={(e) => assign(ticket.id, e.target.value)}
                    placeholder="Unassigned"
                    options={agents.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
