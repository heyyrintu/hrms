'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { payrollApi } from '@/lib/api';
import { payrollDepthApi, SalaryHold } from '@/lib/api-payroll-depth';
import {
  RunListItem,
  employeeName,
  errorMessage,
  formatRunLabel,
  releaseTargets,
  unwrapList,
} from './shared';

const MAX_REASON = 500;

interface HoldDialogProps {
  hold: SalaryHold | null;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Releases a HELD salary into another run (spec C3). Only DRAFT or COMPUTED
 * runs not earlier than the held run's month are offered.
 */
export function ReleaseHoldDialog({ hold, onClose, onDone }: HoldDialogProps) {
  const [targets, setTargets] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetRunId, setTargetRunId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hold) return;
    let cancelled = false;
    setTargetRunId('');
    setLoading(true);
    (async () => {
      try {
        const res = await payrollApi.getRuns();
        if (cancelled) return;
        setTargets(releaseTargets(unwrapList<RunListItem>(res?.data), hold.payrollRun));
      } catch {
        if (!cancelled) toast.error('Failed to load payroll runs');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hold]);

  const submit = async () => {
    if (!hold || !targetRunId) return;
    setSaving(true);
    try {
      await payrollDepthApi.releaseHold(hold.id, targetRunId);
      toast.success('Held salary released');
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to release the held salary'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!hold} onClose={onClose} title="Release held salary">
      {hold && (
        <div className="space-y-3">
          <p className="text-sm text-warm-600">
            Pay {employeeName(hold.employee)}&apos;s salary held in {formatRunLabel(hold.payrollRun)} through
            another run.
          </p>
          {loading ? (
            <p className="text-sm text-warm-500">Loading runs…</p>
          ) : targets.length === 0 ? (
            <p className="text-sm text-warm-500">
              No DRAFT or COMPUTED run from {formatRunLabel(hold.payrollRun)} onwards. Create one first
              (an off-cycle run works for an employee who has left).
            </p>
          ) : (
            <div>
              <label htmlFor="release-target" className="block text-sm font-medium text-warm-700 mb-1">
                Target run
              </label>
              <select
                id="release-target"
                value={targetRunId}
                onChange={(e) => setTargetRunId(e.target.value)}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
              >
                <option value="">Choose a run</option>
                {targets.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatRunLabel(r)} ({r.status})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={saving} disabled={!targetRunId}>Release</Button>
      </ModalFooter>
    </Modal>
  );
}

/** Voids a HELD salary: the net is never paid (spec C3). */
export function VoidHoldDialog({ hold, onClose, onDone }: HoldDialogProps) {
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setReason('');
    setFormError(null);
  }, [hold]);

  const submit = async () => {
    if (!hold) return;
    const trimmed = reason.trim();
    if (!trimmed) return setFormError('Give a reason for voiding');
    setSaving(true);
    try {
      await payrollDepthApi.voidHold(hold.id, trimmed);
      toast.success('Held salary voided');
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to void the held salary'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!hold} onClose={onClose} title="Void held salary">
      {hold && (
        <div className="space-y-3">
          <p className="text-sm text-warm-600">
            {employeeName(hold.employee)}&apos;s net pay for {formatRunLabel(hold.payrollRun)} will never be
            paid. The payslip stays as filed.
          </p>
          <div>
            <label htmlFor="void-reason" className="block text-sm font-medium text-warm-700 mb-1">
              Reason
            </label>
            <textarea
              id="void-reason"
              value={reason}
              maxLength={MAX_REASON}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
            />
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
        </div>
      )}
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={submit} loading={saving}>Void</Button>
      </ModalFooter>
    </Modal>
  );
}
