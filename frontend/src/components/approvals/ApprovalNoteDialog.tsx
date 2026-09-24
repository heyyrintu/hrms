'use client';

import { useEffect, useId, useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export type ApprovalDecisionKind = 'approve' | 'reject';

interface ApprovalNoteDialogProps {
  isOpen: boolean;
  decision: ApprovalDecisionKind;
  /** What is being decided, e.g. "Casual Leave · 3 days". */
  subject?: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

/** Confirm an approve / reject with an optional note for the requester. */
export function ApprovalNoteDialog({
  isOpen,
  decision,
  subject,
  submitting = false,
  onCancel,
  onConfirm,
}: ApprovalNoteDialogProps) {
  const [note, setNote] = useState('');
  const noteId = useId();

  // A fresh note each time the dialog opens.
  useEffect(() => {
    if (isOpen) setNote('');
  }, [isOpen]);

  const isApprove = decision === 'approve';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={isApprove ? 'Approve request' : 'Reject request'}
      size="md"
    >
      {subject && <p className="mb-3 text-sm text-warm-700">{subject}</p>}
      <label htmlFor={noteId} className="label">
        Note (optional)
      </label>
      <textarea
        id={noteId}
        className="input min-h-[96px]"
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={isApprove ? 'Add a note for the requester' : 'Tell the requester why'}
      />
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant={isApprove ? 'primary' : 'danger'}
          loading={submitting}
          onClick={() => onConfirm(note)}
        >
          {isApprove ? 'Confirm approve' : 'Confirm reject'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default ApprovalNoteDialog;
