'use client';

import { useEffect, useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import type { CalibrationRow } from '@/lib/api-performance-calibration';

export const MIN_REASON_LENGTH = 10;

interface Props {
  row: CalibrationRow | null;
  onClose: () => void;
  onSubmit: (reviewId: string, rating: number | null, reason: string) => Promise<void> | void;
}

export function OverrideDialog({ row, onClose, onSubmit }: Props) {
  const [rating, setRating] = useState('3');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (row) {
      setRating(String(row.calibratedRating ?? row.overallRating ?? row.managerRating ?? 3));
      setReason('');
    }
  }, [row]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_REASON_LENGTH;

  const submit = async () => {
    if (!row || !valid) return;
    setSaving(true);
    try {
      await onSubmit(row.reviewId, rating === 'REVERT' ? null : Number(rating), trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={row !== null} onClose={onClose} title={row ? `Override rating: ${row.employeeName}` : 'Override rating'} size="md">
      <div className="space-y-4">
        <Select
          label="New rating"
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
            { value: '4', label: '4' },
            { value: '5', label: '5' },
            { value: 'REVERT', label: 'Revert to manager rating' },
          ]}
        />
        <div>
          <label htmlFor="override-reason" className="label">Reason</label>
          <textarea
            id="override-reason"
            className="input min-h-[90px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why (at least 10 characters). This is recorded in the audit trail."
          />
          <p className="mt-1 text-xs text-warm-500">{trimmed.length}/{MIN_REASON_LENGTH} characters minimum</p>
        </div>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!valid || saving}>Apply override</Button>
      </ModalFooter>
    </Modal>
  );
}
