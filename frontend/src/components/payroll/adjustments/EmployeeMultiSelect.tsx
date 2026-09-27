'use client';

import { useMemo, useState } from 'react';

import type { EmployeeRef } from '@/lib/api-payroll-depth';
import { employeeName } from './shared';

const VISIBLE_LIMIT = 50;

interface Props {
  employees: EmployeeRef[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
  loading?: boolean;
}

/** Searchable checkbox list of employees; matches name or employee code. */
export function EmployeeMultiSelect({ employees, selected, onChange, max = 500, loading }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        employeeName(e).toLowerCase().includes(q) ||
        (e.employeeCode ?? '').toLowerCase().includes(q),
    );
  }, [employees, search]);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else if (selected.length < max) {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="space-y-2">
      <input
        type="search"
        aria-label="Search employees"
        placeholder="Search by name or code"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input"
      />
      <p className="text-xs text-warm-500">
        {selected.length} selected{max ? ` (max ${max})` : ''}
      </p>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-warm-200 divide-y divide-warm-100">
        {loading ? (
          <p className="p-3 text-sm text-warm-500">Loading employees…</p>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-sm text-warm-500">No employees match.</p>
        ) : (
          filtered.slice(0, VISIBLE_LIMIT).map((e) => (
            <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-warm-50">
              <input
                type="checkbox"
                checked={selected.includes(e.id)}
                onChange={() => toggle(e.id)}
                aria-label={`${employeeName(e)} (${e.employeeCode})`}
              />
              <span className="text-warm-900">{employeeName(e)}</span>
              <span className="text-xs text-warm-500">{e.employeeCode}</span>
            </label>
          ))
        )}
        {!loading && filtered.length > VISIBLE_LIMIT && (
          <p className="p-2 text-xs text-warm-500">
            Showing {VISIBLE_LIMIT} of {filtered.length}. Refine the search to see more.
          </p>
        )}
      </div>
    </div>
  );
}
