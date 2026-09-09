'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatMoney, formatDate } from '@/components/settlement/format';
import { exitApi, settlementApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SeparationStatus, SeparationType, SettlementStatus } from '@/types';
import type { Separation, Settlement } from '@/types';
import { BadgeIndianRupee, RefreshCw, Search, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * A separation with no settlement is a normal state, not a missing record, so
 * it gets a state of its own rather than an empty cell.
 */
const NOT_COMPUTED = 'NOT_COMPUTED';

const settlementStateOptions = [
  { value: NOT_COMPUTED, label: 'Not computed' },
  { value: SettlementStatus.DRAFT, label: 'Draft' },
  { value: SettlementStatus.APPROVED, label: 'Approved' },
  { value: SettlementStatus.PAID, label: 'Paid' },
  { value: SettlementStatus.CANCELLED, label: 'Cancelled' },
];

const stateVariants: Record<string, 'info' | 'warning' | 'success' | 'gray'> = {
  [NOT_COMPUTED]: 'gray',
  [SettlementStatus.DRAFT]: 'warning',
  [SettlementStatus.APPROVED]: 'info',
  [SettlementStatus.PAID]: 'success',
  [SettlementStatus.CANCELLED]: 'gray',
};

const typeColors: Record<string, 'info' | 'danger' | 'gray' | 'warning'> = {
  [SeparationType.RESIGNATION]: 'info',
  [SeparationType.TERMINATION]: 'danger',
  [SeparationType.RETIREMENT]: 'gray',
  [SeparationType.END_OF_CONTRACT]: 'gray',
  [SeparationType.MUTUAL_SEPARATION]: 'warning',
  [SeparationType.ABSCONDING]: 'danger',
};

interface Row {
  separation: Separation;
  settlement: Settlement | null;
}

const stateOf = (row: Row): string => row.settlement?.status ?? NOT_COMPUTED;

/**
 * Who is owed a settlement, and what stage each one is at.
 *
 * There is no list-settlements endpoint, so the list is built from the
 * separations and each one's settlement is fetched alongside. A separation
 * whose settlement has not been computed answers 404, which is the expected
 * answer for a new leaver and is shown as "Not computed" rather than as a
 * failure.
 */
export default function SettlementsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeparationStatus, setFilterSeparationStatus] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (filterSeparationStatus) params.status = filterSeparationStatus;
      const sepRes = await exitApi.getAll(params);
      const separations: Separation[] = sepRes.data ?? [];

      const settled = await Promise.allSettled(
        separations.map((s) => settlementApi.getBySeparation(s.id)),
      );

      setRows(
        separations.map((separation, index) => {
          const result = settled[index];
          return {
            separation,
            settlement: result.status === 'fulfilled' ? result.value.data : null,
          };
        }),
      );
    } catch (error) {
      console.error('Failed to load settlements:', error);
      toast.error('Failed to load settlements');
    } finally {
      setLoading(false);
    }
  }, [filterSeparationStatus]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRows = rows.filter((row) => {
    const employee = row.separation.employee;
    const name = employee
      ? `${employee.firstName} ${employee.lastName} ${employee.employeeCode}`
      : '';
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesState = !filterState || stateOf(row) === filterState;
    return matchesSearch && matchesState;
  });

  const counts = {
    all: rows.length,
    notComputed: rows.filter((r) => stateOf(r) === NOT_COMPUTED).length,
    draft: rows.filter((r) => stateOf(r) === SettlementStatus.DRAFT).length,
    approved: rows.filter((r) => stateOf(r) === SettlementStatus.APPROVED).length,
    paid: rows.filter((r) => stateOf(r) === SettlementStatus.PAID).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-warm-900">
            <BadgeIndianRupee className="h-7 w-7 text-primary-600" />
            Full &amp; Final Settlements
          </h1>
          <p className="mt-1 text-warm-600">
            Leavers and the stage their settlement has reached
          </p>
        </div>
        <Button variant="secondary" onClick={loadData} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-warm-900">{counts.all}</p>
            <p className="text-sm text-warm-500">Separations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-warm-400">{counts.notComputed}</p>
            <p className="text-sm text-warm-500">Not computed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{counts.draft}</p>
            <p className="text-sm text-warm-500">Draft</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-sky-600">{counts.approved}</p>
            <p className="text-sm text-warm-500">Approved</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{counts.paid}</p>
            <p className="text-sm text-warm-500">Paid</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-400" />
          <input
            type="text"
            placeholder="Search by employee..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-warm-300 py-2 pl-10 pr-4 focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="separation-status" className="sr-only">
            Separation status
          </label>
          <select
            id="separation-status"
            value={filterSeparationStatus}
            onChange={(e) => setFilterSeparationStatus(e.target.value)}
            className="rounded-lg border border-warm-300 px-3 py-2 focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All separation statuses</option>
            {Object.values(SeparationStatus).map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="settlement-state" className="sr-only">
            Settlement state
          </label>
          <select
            id="settlement-state"
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="rounded-lg border border-warm-300 px-3 py-2 focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All settlement states</option>
            {settlementStateOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : filteredRows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BadgeIndianRupee className="mx-auto mb-4 h-16 w-16 text-warm-300" />
            <h3 className="mb-2 text-lg font-semibold text-warm-900">
              No separations found
            </h3>
            <p className="text-warm-600">
              No exit matches your filters, so there is nothing to settle here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredRows.map((row) => {
            const { separation, settlement } = row;
            const employee = separation.employee;
            const state = stateOf(row);
            return (
              <Card key={separation.id}>
                <CardContent className="py-4">
                  <div
                    data-testid={`settlement-row-${separation.id}`}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-warm-900">
                          {employee
                            ? `${employee.firstName} ${employee.lastName}`
                            : 'Unknown'}
                        </h3>
                        {employee?.employeeCode && (
                          <span className="text-xs text-warm-400">
                            {employee.employeeCode}
                          </span>
                        )}
                        <Badge variant={typeColors[separation.type] ?? 'gray'}>
                          {separation.type.replace(/_/g, ' ')}
                        </Badge>
                        <Badge variant="gray">
                          {separation.status.replace(/_/g, ' ')}
                        </Badge>
                        <Badge variant={stateVariants[state] ?? 'gray'}>
                          {state === NOT_COMPUTED ? 'Not computed' : state}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-warm-400">
                        <span>LWD: {formatDate(separation.lastWorkingDate)}</span>
                        {employee?.department && <span>{employee.department.name}</span>}
                        {!separation.lastWorkingDate && (
                          <span className="text-amber-600">
                            No last working date — a settlement cannot be computed yet
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-warm-500">Net payable</p>
                        <p className="text-sm font-semibold text-warm-900">
                          {settlement ? formatMoney(settlement.netPayable) : '—'}
                        </p>
                      </div>
                      <Link
                        href={`/settlements/${separation.id}`}
                        className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50"
                      >
                        {settlement ? 'Open' : 'Compute'}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
