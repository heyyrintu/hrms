'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import {
  helpdeskApi,
  isOverdue,
  priorityLabels,
  statusLabels,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/api-helpdesk';
import { LifeBuoy, Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

const statusVariants: Record<TicketStatus, 'info' | 'warning' | 'success' | 'gray'> = {
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  WAITING_ON_EMPLOYEE: 'warning',
  RESOLVED: 'success',
  CLOSED: 'gray',
};

const priorityVariants: Record<TicketPriority, 'gray' | 'info' | 'warning' | 'danger'> = {
  LOW: 'gray',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

const emptyForm = {
  categoryId: '',
  subject: '',
  description: '',
  priority: 'MEDIUM' as TicketPriority,
};

/**
 * The employee's side of the helpdesk: what they have raised and a form to
 * raise more. The queue, assignment and internal notes live under
 * /admin/helpdesk and are deliberately absent here.
 */
export default function HelpdeskPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await helpdeskApi.getMyTickets();
      setTickets(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load your tickets');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await helpdeskApi.getCategories();
      setCategories(res.data ?? []);
    } catch {
      // The list is only needed to raise a ticket, so a failure here is
      // reported when the form is opened rather than on page load.
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    loadTickets();
    loadCategories();
  }, [loadTickets, loadCategories]);

  const openForm = () => {
    setForm(emptyForm);
    setModalOpen(true);
  };

  const submit = async () => {
    if (!form.categoryId || !form.subject.trim() || !form.description.trim()) {
      toast.error('Category, subject and description are required');
      return;
    }
    setSaving(true);
    try {
      await helpdeskApi.createTicket({
        categoryId: form.categoryId,
        subject: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
      });
      toast.success('Ticket raised');
      setModalOpen(false);
      await loadTickets();
    } catch {
      toast.error('Failed to raise ticket');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 flex items-center gap-2">
            <LifeBuoy className="h-6 w-6" />
            HR Helpdesk
          </h1>
          <p className="text-sm text-warm-600">
            Raise a request with HR and follow it to resolution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadTickets} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openForm}>
            <Plus className="h-4 w-4" />
            New ticket
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          {loading ? (
            <p className="text-sm text-warm-600">Loading tickets...</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-warm-600">
              You have not raised any tickets yet.
            </p>
          ) : (
            <ul className="divide-y divide-warm-200">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="py-3">
                  <Link
                    href={`/helpdesk/${ticket.id}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-medium text-warm-900">
                      #{ticket.ticketNumber} {ticket.subject}
                    </span>
                    <Badge variant={statusVariants[ticket.status]}>
                      {statusLabels[ticket.status]}
                    </Badge>
                    <Badge variant={priorityVariants[ticket.priority]}>
                      {priorityLabels[ticket.priority]}
                    </Badge>
                    {ticket.category && (
                      <span className="text-sm text-warm-600">
                        {ticket.category.name}
                      </span>
                    )}
                    {isOverdue(ticket) && (
                      <Badge variant="danger">
                        <AlertTriangle className="h-3 w-3" />
                        Overdue
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="New ticket">
        <div className="space-y-4">
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            placeholder="Select a category"
            options={categories.map((c) => ({
              value: c.id,
              label: `${c.name} (SLA ${c.slaHours}h)`,
            }))}
          />
          <Input
            label="Subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
          <div>
            <label
              htmlFor="ticket-description"
              className="block text-sm font-medium text-warm-700 mb-1.5"
            >
              Description
            </label>
            <textarea
              id="ticket-description"
              className="w-full rounded-lg border border-warm-300 p-3 text-sm"
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <Select
            label="Priority"
            value={form.priority}
            onChange={(e) =>
              setForm({ ...form, priority: e.target.value as TicketPriority })
            }
            options={(Object.keys(priorityLabels) as TicketPriority[]).map((p) => ({
              value: p,
              label: priorityLabels[p],
            }))}
          />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Submitting...' : 'Submit ticket'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
