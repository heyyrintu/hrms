'use client';

import toast from 'react-hot-toast';
import { peerApi } from '@/lib/api-performance-peer';
import type { CycleQuestion } from '@/lib/api-performance-reviews';
import { AnswersReadonly } from '@/components/performance/reviews/AnswersReadonly';
import { Button } from '@/components/ui/Button';
import { EmployeePicker } from './EmployeePicker';
import { PeerStatusChip } from './PeerStatusChip';
import { errorMessage, usePeerRows } from './usePeerRows';

interface PeerApprovalsProps {
  reviewId: string;
  employeeId: string;
  reviewerId: string;
  maxPeers: number;
  /** True for the reviewer/admin while the cycle is ACTIVE. */
  canEdit: boolean;
  questions: CycleQuestion[];
}

/** Reviewer/admin view: approve or reject nominations, add peers, read named feedback. */
export function PeerApprovals({ reviewId, employeeId, reviewerId, maxPeers, canEdit, questions }: PeerApprovalsProps) {
  const { rows, loading, error, reload } = usePeerRows(reviewId);
  const used = rows.filter((r) => r.status !== 'REJECTED').length;
  const remaining = Math.max(0, maxPeers - used);

  const decide = async (peerReviewId: string, approve: boolean) => {
    try {
      await peerApi.decide(reviewId, peerReviewId, approve);
      toast.success(approve ? 'Peer approved' : 'Peer rejected');
      await reload();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save decision'));
    }
  };

  const add = async (peerId: string) => {
    try {
      await peerApi.add(reviewId, peerId);
      toast.success('Peer added');
      await reload();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to add peer'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-warm-900">Peer feedback</h4>
        <span className="text-xs text-warm-500">{remaining} of {maxPeers} slots remaining</span>
      </div>

      {loading ? (
        <p className="text-sm text-warm-500">Loading...</p>
      ) : error ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-red-600">Failed to load peers.</p>
          <Button variant="secondary" onClick={reload}>Retry</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-warm-500">No peers nominated yet</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const name = `${r.peer.firstName} ${r.peer.lastName}`;
            return (
              <li key={r.id} className="border border-warm-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-warm-900">{name}</span>
                    <PeerStatusChip status={r.status} />
                    {r.nominatedBy && (
                      <span className="text-xs text-warm-500">
                        nominated by {r.nominatedBy.firstName} {r.nominatedBy.lastName}
                      </span>
                    )}
                  </div>
                  {canEdit && r.status === 'NOMINATED' && (
                    <div className="flex gap-2">
                      <Button variant="primary" aria-label={`Approve ${name}`} onClick={() => decide(r.id, true)}>
                        Approve
                      </Button>
                      <Button variant="danger" aria-label={`Reject ${name}`} onClick={() => decide(r.id, false)}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
                {r.status === 'SUBMITTED' && (
                  <div className="space-y-2">
                    {r.answers && <AnswersReadonly questions={questions} answers={r.answers} audience="PEER" />}
                    {r.overallComment && (
                      <p className="text-sm text-warm-700 bg-warm-50 p-3 rounded whitespace-pre-wrap">{r.overallComment}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && !error && remaining > 0 && (
        <EmployeePicker
          excludeIds={[employeeId, reviewerId, ...rows.map((r) => r.peer.id)]}
          actionLabel="Add peer"
          onPick={add}
        />
      )}
    </div>
  );
}
