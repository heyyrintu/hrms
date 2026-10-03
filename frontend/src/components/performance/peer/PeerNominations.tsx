'use client';

import toast from 'react-hot-toast';
import { peerApi } from '@/lib/api-performance-peer';
import { Button } from '@/components/ui/Button';
import { EmployeePicker } from './EmployeePicker';
import { PeerStatusChip } from './PeerStatusChip';
import { errorMessage, usePeerRows } from './usePeerRows';

interface PeerNominationsProps {
  reviewId: string;
  /** The reviewee (the viewer). Never offered as a peer. */
  employeeId: string;
  reviewerId: string;
  maxPeers: number;
  /** False once the cycle is no longer ACTIVE. */
  canEdit: boolean;
}

/** Employee view: nominate colleagues for 360 feedback and withdraw pending nominations. */
export function PeerNominations({ reviewId, employeeId, reviewerId, maxPeers, canEdit }: PeerNominationsProps) {
  const { rows, loading, reload } = usePeerRows(reviewId);

  const used = rows.filter((r) => r.status !== 'REJECTED').length;
  const remaining = Math.max(0, maxPeers - used);

  const add = async (peerId: string) => {
    try {
      await peerApi.add(reviewId, peerId);
      toast.success('Peer nominated');
      await reload();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to nominate peer'));
    }
  };

  const withdraw = async (peerReviewId: string) => {
    try {
      await peerApi.withdraw(reviewId, peerReviewId);
      toast.success('Nomination withdrawn');
      await reload();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to withdraw nomination'));
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
      ) : rows.length === 0 ? (
        <p className="text-sm text-warm-500">No peers nominated yet</p>
      ) : (
        <ul className="divide-y divide-warm-100 border border-warm-200 rounded-lg">
          {rows.map((r) => {
            const name = `${r.peer.firstName} ${r.peer.lastName}`;
            return (
              <li key={r.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-warm-900">{name}</span>
                  <PeerStatusChip status={r.status} />
                </div>
                {canEdit && r.status === 'NOMINATED' && (
                  <Button variant="secondary" aria-label={`Withdraw ${name}`} onClick={() => withdraw(r.id)}>
                    Withdraw
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && remaining > 0 && (
        <EmployeePicker
          excludeIds={[employeeId, reviewerId, ...rows.map((r) => r.peer.id)]}
          actionLabel="Nominate"
          onPick={add}
        />
      )}
    </div>
  );
}
