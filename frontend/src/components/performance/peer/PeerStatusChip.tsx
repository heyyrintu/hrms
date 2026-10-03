'use client';

import { Badge } from '@/components/ui/Badge';
import type { PeerStatus } from '@/lib/api-performance-peer';

const labels: Record<PeerStatus, string> = {
  NOMINATED: 'Nominated',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUBMITTED: 'Submitted',
  DECLINED: 'Declined',
};
const variants: Record<PeerStatus, 'warning' | 'info' | 'danger' | 'success' | 'gray'> = {
  NOMINATED: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  SUBMITTED: 'success',
  DECLINED: 'gray',
};

export function PeerStatusChip({ status }: { status: PeerStatus }) {
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}
