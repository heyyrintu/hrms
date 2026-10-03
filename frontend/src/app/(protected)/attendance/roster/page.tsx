'use client';

import { useCallback, useEffect, useState } from 'react';

import { GridPager } from '@/components/roster/GridPager';
import { RosterGrid } from '@/components/roster/RosterGrid';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { shiftsApi } from '@/lib/api';
import { rosterApi, type RosterCell, type RosterGrid as RosterGridData } from '@/lib/api-roster';
import type { Shift } from '@/lib/api-shifts';
import { currentEmployeeId } from '@/lib/current-employee';
import { parseLocalDate, toLocalIso, todayLocalIso } from '@/lib/date';
import { cn } from '@/lib/utils';
import { UserRole } from '@/types';

const WINDOW_DAYS = 14;

function plusDays(iso: string, n: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + n);
  return toLocalIso(d);
}

function describe(cell: RosterCell): { label: string; detail: string; tone: 'shift' | 'off' | 'none' } {
  if (cell.isOff) return { label: 'Day off', detail: '', tone: 'off' };
  if (cell.shiftCode) {
    return {
      label: cell.shiftCode,
      detail: `${cell.shiftName ?? ''}${cell.isOvernight ? ' \u{1F319} overnight' : ''}`.trim(),
      tone: 'shift',
    };
  }
  return { label: '—', detail: 'No shift', tone: 'none' };
}

export default function MyShiftsPage() {
  const { user, hasRole } = useAuth();
  const employeeId = currentEmployeeId(user);
  const showTeam = hasRole(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN);

  const [cells, setCells] = useState<RosterCell[]>([]);
  const [loading, setLoading] = useState(!!employeeId);
  const [error, setError] = useState(false);

  const [team, setTeam] = useState<RosterGridData | null>(null);
  const [teamShifts, setTeamShifts] = useState<Shift[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState(false);
  const [teamPage, setTeamPage] = useState(1);

  const range = useCallback(() => {
    const from = todayLocalIso();
    return { from, to: plusDays(from, WINDOW_DAYS - 1) };
  }, []);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await rosterApi.getMine(range());
      setCells(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [range]);

  const loadTeam = useCallback(async () => {
    setTeamLoading(true);
    setTeamError(false);
    try {
      const [grid, shifts] = await Promise.all([
        rosterApi.getGrid({ ...range(), ...(teamPage > 1 ? { page: teamPage } : {}) }),
        shiftsApi.getAll().catch(() => ({ data: [] as Shift[] })),
      ]);
      setTeam(grid.data);
      setTeamShifts(shifts.data);
    } catch {
      setTeamError(true);
    } finally {
      setTeamLoading(false);
    }
  }, [range, teamPage]);

  useEffect(() => {
    if (employeeId) loadMine();
  }, [employeeId, loadMine]);

  useEffect(() => {
    if (showTeam) loadTeam();
  }, [showTeam, loadTeam]);

  const anyShift = cells.some((c) => c.isOff || c.shiftCode);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-warm-900">My shifts</h1>
        <p className="text-sm text-warm-500">{`Your schedule for the next ${WINDOW_DAYS} days.`}</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {!employeeId ? (
            <p className="py-6 text-center text-sm text-warm-500">
              No employee record is linked to your account.
            </p>
          ) : loading ? (
            <p className="py-6 text-center text-sm text-warm-500">Loading your shifts...</p>
          ) : error ? (
            <div className="py-6 text-center">
              <p className="mb-3 text-sm text-red-600">Failed to load your shifts.</p>
              <Button variant="secondary" onClick={loadMine}>
                Retry
              </Button>
            </div>
          ) : !anyShift ? (
            <p className="py-6 text-center text-sm text-warm-500">
              {`No shifts scheduled for the next ${WINDOW_DAYS} days.`}
            </p>
          ) : (
            <ul className="divide-y divide-warm-200">
              {cells.map((cell) => {
                const d = describe(cell);
                const date = parseLocalDate(cell.date);
                return (
                  <li key={cell.date} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="font-medium text-warm-900">
                        {date.toLocaleDateString('en-IN', { weekday: 'long' })}
                      </div>
                      <div className="text-xs text-warm-500">
                        {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                    <div className="text-right">
                      <span
                        className={cn(
                          'rounded-md px-2.5 py-1 text-sm font-semibold',
                          d.tone === 'shift' && 'bg-primary-50 text-primary-800',
                          d.tone === 'off' && 'bg-warm-100 text-warm-600',
                          d.tone === 'none' && 'text-warm-400',
                        )}
                      >
                        {d.label}
                      </span>
                      {d.detail && <div className="mt-0.5 text-xs text-warm-500">{d.detail}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {showTeam && (
        <Card>
          <CardHeader>
            <CardTitle>Team roster</CardTitle>
          </CardHeader>
          <CardContent>
            {teamLoading ? (
              <p className="py-6 text-center text-sm text-warm-500">Loading team roster...</p>
            ) : teamError ? (
              <div className="py-6 text-center">
                <p className="mb-3 text-sm text-red-600">Failed to load the team roster.</p>
                <Button variant="secondary" onClick={loadTeam}>
                  Retry
                </Button>
              </div>
            ) : team ? (
              <>
                <RosterGrid grid={team} shifts={teamShifts} editable={false} />
                <GridPager meta={team.meta} onPage={setTeamPage} />
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
