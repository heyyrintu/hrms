'use client';

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  TableLoadingState,
} from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { LeaderboardPeriod, LeaderboardRow } from '@/lib/api-recognition';

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  period: LeaderboardPeriod;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  pointsEnabled: boolean;
  loading?: boolean;
}

/** Period switcher plus the ranked table it drives. */
export function LeaderboardTable({
  rows,
  period,
  onPeriodChange,
  pointsEnabled,
  loading,
}: LeaderboardTableProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Leaderboard period">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            type="button"
            variant={p.value === period ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={p.value === period}
            className={cn(p.value === period && 'font-semibold')}
            onClick={() => onPeriodChange(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>{pointsEnabled ? 'Points' : 'Recognitions'}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoadingState colSpan={4} />
          ) : rows.length === 0 ? (
            <TableEmptyState colSpan={4} message="No recognitions yet for this period" />
          ) : (
            rows.map((row) => (
              <TableRow key={row.employeeId}>
                <TableCell>{row.rank}</TableCell>
                <TableCell>
                  {row.firstName} {row.lastName}
                  {row.employeeCode && (
                    <span className="ml-1 text-xs text-warm-500">({row.employeeCode})</span>
                  )}
                </TableCell>
                <TableCell>{row.department ?? '—'}</TableCell>
                <TableCell>{pointsEnabled ? row.points : row.count}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
