'use client';

import { Badge } from '@/components/ui/Badge';
import type { PayrollRunType } from '@/lib/api-payroll-depth';

/** REGULAR for monthly runs (and old rows without a type), "Off-cycle #n" otherwise. */
export function RunTypeBadge({ runType, sequence }: { runType?: PayrollRunType; sequence?: number }) {
  if (runType === 'OFF_CYCLE') {
    return <Badge variant="warning">Off-cycle #{sequence ?? 0}</Badge>;
  }
  return <Badge variant="gray">Regular</Badge>;
}
