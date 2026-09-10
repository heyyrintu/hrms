'use client';

import { ReactNode } from 'react';
import { CalendarDays, Palmtree, Undo2, Info } from 'lucide-react';
import type { SettlementBreakdown } from '@/types';
import { formatMoney, formatDays } from './format';
import { GratuityWorking } from './GratuityWorking';

interface SettlementWorkingProps {
  breakdown: SettlementBreakdown;
}

interface SectionProps {
  testId: string;
  icon: ReactNode;
  title: string;
  amount: string;
  amountLabel?: string;
  note: string;
  children: ReactNode;
}

/**
 * One line of the working: what it came to, how it was arrived at, and the
 * note recording the basis. The note is not decoration — it is the answer the
 * leaver is owed when they ask why a figure is what it is, so it is always
 * rendered.
 */
function Section({
  testId,
  icon,
  title,
  amount,
  amountLabel = 'Amount',
  note,
  children,
}: SectionProps) {
  return (
    <div data-testid={testId} className="rounded-lg border border-warm-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-warm-200 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-warm-900">
          {icon}
          {title}
        </h3>
        <div className="text-right">
          <p className="text-xs text-warm-500">{amountLabel}</p>
          <p className="text-sm font-semibold text-warm-900">{formatMoney(amount)}</p>
        </div>
      </div>
      <div className="space-y-3 px-4 py-4">
        {children}
        <p className="flex items-start gap-2 border-t border-warm-100 pt-3 text-xs text-warm-500">
          <Info className="mt-0.5 w-3.5 h-3.5 shrink-0" />
          <span>{note}</span>
        </p>
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-warm-500">{label}</dt>
      <dd className="font-medium text-warm-900">{value}</dd>
    </div>
  );
}

/**
 * The full and final settlement working: pro-rata salary for the part month,
 * encashment of unused leave, gratuity, and recovery for notice not served.
 */
export function SettlementWorking({ breakdown }: SettlementWorkingProps) {
  const { proRata, leaveEncashment, gratuity, noticeRecovery } = breakdown;

  return (
    <div className="space-y-4">
      <Section
        testId="pro-rata-working"
        icon={<CalendarDays className="w-4 h-4 text-primary-600" />}
        title="Pro-rata salary"
        amount={proRata.amount}
        note={proRata.note}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <Figure label="Monthly gross" value={formatMoney(proRata.monthlyGross)} />
          <Figure
            label="Days worked"
            value={`${proRata.daysWorked} of ${proRata.daysInMonth} days`}
          />
          <Figure label="Last drawn wages" value={formatMoney(breakdown.lastDrawnWages)} />
        </dl>
      </Section>

      <Section
        testId="leave-encashment-working"
        icon={<Palmtree className="w-4 h-4 text-primary-600" />}
        title="Leave encashment"
        amount={leaveEncashment.amount}
        note={leaveEncashment.note}
      >
        {leaveEncashment.enabled ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Figure label="Per-day rate" value={formatMoney(leaveEncashment.perDayRate)} />
              <Figure
                label="Days encashed"
                value={<span>{formatDays(leaveEncashment.totalDays)}</span>}
              />
              <Figure label="Basis" value={leaveEncashment.basis} />
            </dl>
            {leaveEncashment.leaveTypes.length > 0 && (
              <ul className="divide-y divide-warm-100 rounded-lg bg-warm-50 px-3 text-sm">
                {leaveEncashment.leaveTypes.map((type) => (
                  <li key={type.name} className="flex justify-between py-2">
                    <span className="text-warm-600">{type.name}</span>
                    <span className="font-medium text-warm-900">{type.days} days</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-warm-600">
            Leave encashment is not enabled for this tenant, so no leave has been
            encashed in this settlement.
          </p>
        )}
      </Section>

      <GratuityWorking gratuity={gratuity} />

      <Section
        testId="notice-recovery-working"
        icon={<Undo2 className="w-4 h-4 text-primary-600" />}
        title="Notice recovery"
        amount={noticeRecovery.amount}
        amountLabel="Recovered"
        note={noticeRecovery.note}
      >
        {noticeRecovery.waived ? (
          <p className="text-sm text-warm-600">
            Notice period was waived on this separation, so nothing is recovered.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <Figure
              label="Notice required"
              value={
                <>
                  <span>{noticeRecovery.required}</span> days
                </>
              }
            />
            <Figure
              label="Notice served"
              value={
                <>
                  <span>{noticeRecovery.served}</span> days
                </>
              }
            />
            <Figure
              label="Shortfall"
              value={
                <>
                  <span>{noticeRecovery.shortfallDays}</span> days
                </>
              }
            />
            <Figure label="Daily rate" value={formatMoney(noticeRecovery.dailyRate)} />
          </dl>
        )}
      </Section>
    </div>
  );
}
