'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { employeesApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';

interface PickableEmployee { id: string; firstName: string; lastName: string }

interface EmployeePickerProps {
  /** Employee ids that must not be offered (self, reviewer, existing peers). */
  excludeIds: string[];
  actionLabel: string;
  onPick: (employeeId: string) => Promise<void> | void;
  disabled?: boolean;
}

export function EmployeePicker({ excludeIds, actionLabel, onPick, disabled }: EmployeePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickableEmployee[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await employeesApi.getAll({ search: query.trim(), limit: 10 });
      setResults((res.data?.data ?? []) as PickableEmployee[]);
    } catch {
      toast.error('Failed to search colleagues');
    } finally {
      setSearching(false);
    }
  };

  const pick = async (id: string) => {
    setBusyId(id);
    try {
      await onPick(id);
      setResults((r) => r.filter((e) => e.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  const visible = results.filter((e) => !excludeIds.includes(e.id));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          placeholder="Search colleagues"
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          className="flex-1 px-3 py-2 border border-warm-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
        />
        <Button variant="secondary" onClick={search} disabled={disabled || searching}>
          Search
        </Button>
      </div>
      {visible.length > 0 && (
        <ul className="divide-y divide-warm-100 border border-warm-200 rounded-lg">
          {visible.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm text-warm-900">{e.firstName} {e.lastName}</span>
              <Button
                variant="primary"
                aria-label={`${actionLabel} ${e.firstName} ${e.lastName}`}
                disabled={disabled || busyId !== null}
                onClick={() => pick(e.id)}
              >
                {actionLabel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
