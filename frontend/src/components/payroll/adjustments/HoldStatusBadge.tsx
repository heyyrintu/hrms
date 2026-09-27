'use client';

import { Badge } from '@/components/ui/Badge';
import type { SalaryArrearStatus, SalaryHoldStatus } from '@/lib/api-payroll-depth';

const HOLD_VARIANTS: Record<SalaryHoldStatus, 'warning' | 'success' | 'danger'> = {
  HELD: 'warning',
  RELEASED: 'success',
  VOIDED: 'danger',
};

export function HoldStatusBadge({ status }: { status: SalaryHoldStatus }) {
  return <Badge variant={HOLD_VARIANTS[status] ?? 'gray'}>{status}</Badge>;
}

const ARREAR_VARIANTS: Record<SalaryArrearStatus, 'warning' | 'info' | 'success' | 'gray'> = {
  PENDING: 'warning',
  INCLUDED: 'info',
  PAID: 'success',
  CANCELLED: 'gray',
};

export function ArrearStatusBadge({ status }: { status: SalaryArrearStatus }) {
  return <Badge variant={ARREAR_VARIANTS[status] ?? 'gray'}>{status}</Badge>;
}
