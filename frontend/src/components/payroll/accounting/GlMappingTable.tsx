'use client';

import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import type { GlKnownKey } from '@/lib/api-payroll-accounting';

export interface MappingDraft {
  glCode: string;
  glName: string;
}

interface GlMappingTableProps {
  knownKeys: GlKnownKey[];
  values: Record<string, MappingDraft>;
  onChange: (key: string, field: keyof MappingDraft, value: string) => void;
}

/**
 * One row per key the tenant can map: every GL system key, plus component and
 * one-time payment names discovered from their own data. Unmapped rows are
 * highlighted so a reviewer can see at a glance what still needs an account.
 */
export function GlMappingTable({ knownKeys, values, onChange }: GlMappingTableProps) {
  if (knownKeys.length === 0) {
    return (
      <Table>
        <TableBody>
          <TableEmptyState message="No components to map yet." colSpan={5} />
        </TableBody>
      </Table>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>GL code</TableHead>
          <TableHead>GL name</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {knownKeys.map((key) => {
          const draft = values[key.key] ?? { glCode: '', glName: '' };
          const filled = draft.glCode.trim() !== '' && draft.glName.trim() !== '';
          return (
            <TableRow key={key.key} data-testid={`gl-key-${key.key}`}>
              <TableCell>
                <p className="font-medium text-warm-900">{key.label}</p>
                {key.label !== key.key ? <p className="text-xs text-warm-500">{key.key}</p> : null}
              </TableCell>
              <TableCell>
                <span className="text-xs text-warm-600">
                  {key.category} · {key.side === 'DEBIT' ? 'Debit' : 'Credit'}
                </span>
              </TableCell>
              <TableCell>
                <Input
                  aria-label={`GL code for ${key.key}`}
                  value={draft.glCode}
                  onChange={(e) => onChange(key.key, 'glCode', e.target.value)}
                  placeholder="e.g. 4001"
                />
              </TableCell>
              <TableCell>
                <Input
                  aria-label={`GL name for ${key.key}`}
                  value={draft.glName}
                  onChange={(e) => onChange(key.key, 'glName', e.target.value)}
                  placeholder="e.g. Salaries"
                />
              </TableCell>
              <TableCell>
                {filled ? (
                  <Badge variant="success">Mapped</Badge>
                ) : (
                  <Badge variant="warning">Unmapped</Badge>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
