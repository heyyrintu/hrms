'use client';

import { useEffect, useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import type { Counterpart, CreateOneOnOnePayload } from '@/lib/api-one-on-ones';

interface ScheduleOneOnOneModalProps {
  isOpen: boolean;
  onClose: () => void;
  counterparts: Counterpart[];
  saving?: boolean;
  onSubmit: (data: CreateOneOnOnePayload) => void | Promise<void>;
}

const relationLabel: Record<Counterpart['relation'], string> = {
  MANAGER: 'Manager',
  REPORT: 'Direct report',
};

/**
 * Schedule a one-on-one with my manager or a direct report. The counterpart
 * list comes from `GET /engagement/one-on-ones/counterparts`, which already
 * excludes inactive/exited employees, so every option here is valid.
 */
export function ScheduleOneOnOneModal({
  isOpen,
  onClose,
  counterparts,
  saving = false,
  onSubmit,
}: ScheduleOneOnOneModalProps) {
  const [counterpartId, setCounterpartId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [agenda, setAgenda] = useState('');

  useEffect(() => {
    if (isOpen) {
      setCounterpartId('');
      setScheduledAt('');
      setAgenda('');
    }
  }, [isOpen]);

  const submit = async () => {
    if (!counterpartId || !scheduledAt) {
      return;
    }
    await onSubmit({
      counterpartId,
      scheduledAt: new Date(scheduledAt).toISOString(),
      agenda: agenda.trim() || undefined,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Schedule one-on-one">
      <div className="space-y-4">
        <Select
          label="With"
          value={counterpartId}
          onChange={(e) => setCounterpartId(e.target.value)}
          placeholder="Select your manager or a direct report"
          options={counterparts.map((c) => ({
            value: c.id,
            label: `${c.firstName} ${c.lastName} (${relationLabel[c.relation]})`,
          }))}
        />
        <Input
          type="datetime-local"
          label="When"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
        <div>
          <label htmlFor="one-on-one-agenda" className="block text-sm font-medium text-warm-700 mb-1.5">
            Agenda (optional)
          </label>
          <textarea
            id="one-on-one-agenda"
            className="w-full rounded-lg border border-warm-300 p-3 text-sm"
            rows={3}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
          />
        </div>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving || !counterpartId || !scheduledAt}>
          {saving ? 'Scheduling...' : 'Schedule'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
