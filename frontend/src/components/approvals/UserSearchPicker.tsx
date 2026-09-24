'use client';

import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { ApproverCandidate, USER_ROLE_LABELS, workflowApi } from '@/lib/api-workflow';

export interface PickedUser {
  id: string;
  name: string;
}

interface UserSearchPickerProps {
  label: string;
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  placeholder?: string;
  /** Hide a user from the results, e.g. yourself when delegating. */
  excludeUserId?: string;
  id?: string;
}

const DEBOUNCE_MS = 250;

/**
 * Type-ahead over `GET /approvals/users?search=` (active tenant users, max 20).
 * Shows the chosen user as a chip with a clear button once picked.
 */
export function UserSearchPicker({
  label,
  value,
  onChange,
  placeholder = 'Search by name or email',
  excludeUserId,
  id,
}: UserSearchPickerProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ApproverCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await workflowApi.searchUsers(term);
        if (!cancelled) setResults(res.data ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const visible = results.filter((u) => u.id !== excludeUserId);

  if (value) {
    return (
      <div className="space-y-1.5">
        <span className="label">{label}</span>
        <div className="flex items-center justify-between rounded-lg border border-warm-300 bg-warm-50 px-3 py-2 text-sm">
          <span className="text-warm-900">{value.name}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded p-1 text-warm-400 hover:bg-warm-100 hover:text-warm-700"
            aria-label={`Clear ${label}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-1.5">
      <label htmlFor={inputId} className="label">
        {label}
      </label>
      <input
        id={inputId}
        className="input"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() && (
        <ul
          role="listbox"
          aria-label={`${label} results`}
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-warm-200 bg-white shadow-dropdown"
        >
          {searching && visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-warm-500">Searching...</li>
          ) : visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-warm-500">No matching users</li>
          ) : (
            visible.map((user) => (
              <li key={user.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-warm-50"
                  onClick={() => {
                    onChange({ id: user.id, name: user.name });
                    setQuery('');
                    setResults([]);
                  }}
                >
                  <span className="block font-medium text-warm-900">{user.name}</span>
                  <span className="block text-xs text-warm-500">
                    {user.email} · {USER_ROLE_LABELS[user.role] ?? user.role}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export default UserSearchPicker;
