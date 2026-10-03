'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { CellUpdate, RosterCell, RosterGrid as RosterGridData } from '@/lib/api-roster';
import type { Shift } from '@/lib/api-shifts';
import { parseLocalDate } from '@/lib/date';
import { cn } from '@/lib/utils';

export interface RosterGridProps {
  grid: RosterGridData;
  shifts: Shift[];
  editable: boolean;
  onSave?: (cells: CellUpdate[]) => Promise<void>;
}

const keyOf = (employeeId: string, date: string) => `${employeeId}|${date}`;

function dayLabel(iso: string): { weekday: string; day: string } {
  const date = parseLocalDate(iso);
  return {
    weekday: date.toLocaleDateString('en-IN', { weekday: 'short' }),
    day: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
  };
}

function cellText(cell: Pick<RosterCell, 'isOff' | 'shiftCode' | 'isOvernight'>): string {
  if (cell.isOff) return 'OFF';
  if (cell.shiftCode) return cell.isOvernight ? `${cell.shiftCode} \u{1F319}` : cell.shiftCode;
  return '—';
}

/**
 * Employees by days. Cells that come from the roster are solid, cells that
 * fall back to a shift assignment are muted. When `editable`, clicking a cell
 * picks a shift, OFF, or "clear" (back to the assignment); the picks batch
 * into one Save.
 */
export function RosterGrid({ grid, shifts, editable, onSave }: RosterGridProps) {
  const [dirty, setDirty] = useState<Record<string, CellUpdate>>({});
  const [picking, setPicking] = useState<{ employeeId: string; date: string; name: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const shiftById = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const dirtyCount = Object.keys(dirty).length;

  const choose = (update: Omit<CellUpdate, 'employeeId' | 'date'>) => {
    if (!picking) return;
    const { employeeId, date } = picking;
    setDirty((prev) => ({ ...prev, [keyOf(employeeId, date)]: { employeeId, date, ...update } }));
    setPicking(null);
  };

  const save = async () => {
    if (!onSave || dirtyCount === 0) return;
    setSaving(true);
    try {
      await onSave(Object.values(dirty));
      setDirty({});
    } catch {
      // The caller reports the failure; keep the edits so nothing is lost.
    } finally {
      setSaving(false);
    }
  };

  if (grid.rows.length === 0) {
    return <p className="py-8 text-center text-sm text-warm-500">No employees to show.</p>;
  }

  return (
    <div className="space-y-3">
      {editable && dirtyCount > 0 && (
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {`Save (${dirtyCount})`}
          </Button>
          <Button variant="secondary" onClick={() => setDirty({})} disabled={saving}>
            Discard
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-warm-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-warm-50">
              <th className="sticky left-0 z-10 min-w-[10rem] bg-warm-50 px-3 py-2 text-left font-medium text-warm-700">
                Employee
              </th>
              {grid.days.map((iso) => {
                const label = dayLabel(iso);
                return (
                  <th key={iso} className="px-2 py-2 text-center font-medium text-warm-700">
                    <div>{label.weekday}</div>
                    <div className="text-xs font-normal text-warm-500">{label.day}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.employee.id} className="border-t border-warm-200">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-warm-900"
                >
                  <div>{row.employee.name}</div>
                  <div className="text-xs font-normal text-warm-500">
                    {row.employee.code}
                    {row.employee.department ? ` · ${row.employee.department}` : ''}
                  </div>
                </th>
                {row.cells.map((cell) => {
                  const pending = dirty[keyOf(row.employee.id, cell.date)];
                  const shown = pending
                    ? pending.clear
                      ? { isOff: false, shiftCode: null, isOvernight: false }
                      : pending.isOff
                        ? { isOff: true, shiftCode: null, isOvernight: false }
                        : {
                            isOff: false,
                            shiftCode: shiftById.get(pending.shiftId ?? '')?.code ?? null,
                            isOvernight: !!shiftById.get(pending.shiftId ?? '')?.isOvernight,
                          }
                    : cell;
                  const muted = !pending && cell.source === 'ASSIGNMENT';
                  const classes = cn(
                    'w-full min-w-[3.5rem] rounded-md px-2 py-1.5 text-center text-xs font-semibold',
                    shown.isOff ? 'bg-warm-100 text-warm-600' : 'bg-primary-50 text-primary-800',
                    muted && 'opacity-60',
                    pending && 'ring-2 ring-amber-400',
                  );
                  return (
                    <td key={cell.date} className="px-1 py-1 text-center">
                      {editable ? (
                        <button
                          type="button"
                          data-testid={`cell-${row.employee.id}-${cell.date}`}
                          className={classes}
                          onClick={() =>
                            setPicking({
                              employeeId: row.employee.id,
                              date: cell.date,
                              name: row.employee.name,
                            })
                          }
                        >
                          {cellText(shown)}
                        </button>
                      ) : (
                        <div
                          data-testid={`cell-${row.employee.id}-${cell.date}`}
                          className={classes}
                        >
                          {cellText(shown)}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && (
        <Modal
          isOpen={picking !== null}
          onClose={() => setPicking(null)}
          title={picking ? `${picking.name} · ${picking.date}` : 'Set shift'}
          size="sm"
        >
          <div className="space-y-2">
            {shifts
              .filter((s) => s.isActive)
              .map((s) => (
                <Button
                  key={s.id}
                  variant="secondary"
                  className="w-full justify-start"
                  data-testid={`pick-shift-${s.id}`}
                  onClick={() => choose({ shiftId: s.id })}
                >
                  {`${s.code} · ${s.name} (${s.startTime}-${s.endTime})`}
                </Button>
              ))}
            <Button
              variant="secondary"
              className="w-full justify-start"
              data-testid="pick-off"
              onClick={() => choose({ isOff: true })}
            >
              OFF (day off)
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              data-testid="pick-clear"
              onClick={() => choose({ clear: true })}
            >
              Clear (use shift assignment)
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
