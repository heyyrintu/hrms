'use client';

import { useMemo, useState } from 'react';

import type { SalaryHold } from '@/lib/api-payroll-depth';
import { HoldsTab } from './HoldsTab';
import { OneTimePaymentsTab } from './OneTimePaymentsTab';
import { ReimbursementsTab } from './ReimbursementsTab';
import { RunArrearsTab } from './RunArrearsTab';
import { SettlementsTab } from './SettlementsTab';
import { useEmployeeOptions } from './useEmployeeOptions';
import type { RunContext, RunEmployee } from './types';

type TabKey = 'one-time' | 'holds' | 'reimbursements' | 'arrears' | 'settlements';

interface Props {
  run: RunContext;
  /** Off-cycle scope (`scopeEmployeeIds`); ignored for regular runs. */
  scopeEmployeeIds: string[];
  /** Employees who already have a payslip in the run. */
  payslipEmployees: RunEmployee[];
  holds: SalaryHold[];
  holdsLoading: boolean;
  holdsError: boolean;
  reloadHolds: () => void;
  /** Refetch the run after its inputs changed (shows the needsRecompute banner). */
  onInputsChanged: () => void;
}

/**
 * The run's adjustments: one-time payments, holds, reimbursements, arrears and
 * (off-cycle only) settlements.
 */
export function RunAdjustmentsTabs(props: Props) {
  const { run, scopeEmployeeIds, payslipEmployees } = props;
  const [tab, setTab] = useState<TabKey>('one-time');
  const offCycle = run.runType === 'OFF_CYCLE';
  const { employees: loaded } = useEmployeeOptions(true, offCycle ? undefined : 'ACTIVE');

  // A regular run covers active employees; an off-cycle run only its scope.
  // Payslip employees are always offered (they may no longer be active).
  const employees = useMemo(() => {
    const scope = new Set(scopeEmployeeIds);
    const byId = new Map<string, RunEmployee>();
    for (const e of payslipEmployees) byId.set(e.id, e);
    for (const e of loaded) {
      if (offCycle && !scope.has(e.id)) continue;
      if (!byId.has(e.id)) {
        byId.set(e.id, { id: e.id, employeeCode: e.employeeCode, firstName: e.firstName, lastName: e.lastName });
      }
    }
    return [...byId.values()].sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    );
  }, [loaded, payslipEmployees, scopeEmployeeIds, offCycle]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'one-time', label: 'One-time payments' },
    { key: 'holds', label: 'Holds' },
    { key: 'reimbursements', label: 'Reimbursements' },
    { key: 'arrears', label: 'Arrears' },
    ...(offCycle ? [{ key: 'settlements' as TabKey, label: 'Settlements' }] : []),
  ];

  return (
    <div className="rounded-xl border border-warm-200 bg-white">
      <div role="tablist" aria-label="Run adjustments" className="flex flex-wrap gap-1 border-b border-warm-200 px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${
              tab === t.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-warm-500 hover:text-warm-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="p-4">
        {tab === 'one-time' && (
          <OneTimePaymentsTab run={run} employees={employees} onInputsChanged={props.onInputsChanged} />
        )}
        {tab === 'holds' && (
          <HoldsTab
            run={run}
            holds={props.holds}
            loading={props.holdsLoading}
            loadError={props.holdsError}
            employees={employees}
            onChanged={props.reloadHolds}
          />
        )}
        {tab === 'reimbursements' && <ReimbursementsTab runId={run.id} />}
        {tab === 'arrears' && <RunArrearsTab runId={run.id} />}
        {tab === 'settlements' && offCycle && <SettlementsTab run={run} onInputsChanged={props.onInputsChanged} />}
      </div>
    </div>
  );
}
