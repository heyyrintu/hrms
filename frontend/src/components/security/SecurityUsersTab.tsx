'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHead,
  TableHeader,
  TableLoadingState,
  TableRow,
} from '@/components/ui/Table';
import { useAuth } from '@/contexts/AuthContext';
import { securityApi } from '@/lib/api-security';
import { CustomRoleView, Paginated, SecurityUserRow } from '@/types/security';
import { UserRole } from '@/types';

const DEBOUNCE_MS = 300;
const PAGE_LIMIT = 20;

/**
 * Users, role assignment and 2FA reset — built by WS-1 (plan Task 1.6).
 * Debounced search, paginated table, a role-assignment dialog, and a
 * Reset 2FA action gated on the row's own 2FA status and, for a
 * SUPER_ADMIN row, on the viewer also being SUPER_ADMIN.
 */
export default function SecurityUsersTab() {
  const { isSuperAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<SecurityUserRow>>({
    data: [],
    meta: { total: 0, page: 1, limit: PAGE_LIMIT, totalPages: 0 },
  });
  const [loading, setLoading] = useState(true);

  const [roles, setRoles] = useState<CustomRoleView[]>([]);
  const [rolesTarget, setRolesTarget] = useState<SecurityUserRow | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  const [resetTarget, setResetTarget] = useState<SecurityUserRow | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async (searchValue: string, pageValue: number) => {
    setLoading(true);
    try {
      const res = await securityApi.getUsers({
        search: searchValue || undefined,
        page: pageValue,
        limit: PAGE_LIMIT,
      });
      setResult(res.data);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce: reset to page 1 whenever the search text settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      load(search, 1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (page === 1) return; // the search effect already loads page 1
    load(search, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const openRoles = async (row: SecurityUserRow) => {
    setRolesTarget(row);
    setSelectedRoleIds(row.customRoles.map((r) => r.id));
    try {
      const res = await securityApi.getRoles();
      setRoles(res.data);
    } catch {
      toast.error('Failed to load custom roles');
    }
  };

  const toggleRole = (id: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  };

  const saveRoles = async () => {
    if (!rolesTarget) return;
    setSavingRoles(true);
    try {
      await securityApi.setUserRoles(rolesTarget.id, selectedRoleIds);
      toast.success('Roles updated');
      setRolesTarget(null);
      load(search, page);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update roles');
    } finally {
      setSavingRoles(false);
    }
  };

  const confirmReset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      await securityApi.resetUserTwoFactor(resetTarget.id);
      toast.success('Two-factor authentication reset');
      setResetTarget(null);
      load(search, page);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to reset two-factor authentication');
    } finally {
      setResetting(false);
    }
  };

  const canResetRow = (row: SecurityUserRow) => row.role !== UserRole.SUPER_ADMIN || isSuperAdmin;

  return (
    <div>
      <div className="mb-4">
        <Input
          placeholder="Search by email or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Custom roles</TableHead>
            <TableHead>2FA</TableHead>
            <TableHead>SSO</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoadingState colSpan={7} />
          ) : result.data.length === 0 ? (
            <TableEmptyState message="No users found" colSpan={7} />
          ) : (
            result.data.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-warm-900">{row.email}</TableCell>
                <TableCell className="text-warm-600">{row.employeeName || '—'}</TableCell>
                <TableCell>
                  <Badge variant="gray">{row.role}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.customRoles.map((r) => (
                      <Badge key={r.id}>{r.name}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {row.twoFactorEnabled ? (
                    <Badge variant="success">
                      <ShieldCheck className="h-3 w-3 mr-1 inline" aria-hidden="true" />
                      On
                    </Badge>
                  ) : (
                    <Badge variant="gray">Off</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.ssoProviders.map((p) => (
                      <Badge key={p} variant="info">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Roles for ${row.email}`}
                      onClick={() => openRoles(row)}
                    >
                      Roles
                    </Button>
                    {canResetRow(row) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Reset 2FA for ${row.email}`}
                        disabled={!row.twoFactorEnabled}
                        onClick={() => setResetTarget(row)}
                      >
                        Reset 2FA
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {result.meta.totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-warm-500">
          <span>
            Page {result.meta.page} of {result.meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={result.meta.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={result.meta.page >= result.meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Modal
        isOpen={!!rolesTarget}
        onClose={() => setRolesTarget(null)}
        title={rolesTarget ? `Roles for ${rolesTarget.email}` : 'Roles'}
      >
        <div className="space-y-1.5">
          {roles.map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={role.name}
                checked={selectedRoleIds.includes(role.id)}
                onChange={() => toggleRole(role.id)}
              />
              {role.name}
            </label>
          ))}
          {roles.length === 0 && (
            <p className="text-sm text-warm-500">No custom roles have been created yet.</p>
          )}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRolesTarget(null)} disabled={savingRoles}>
            Cancel
          </Button>
          <Button onClick={saveRoles} loading={savingRoles}>
            Save
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title="Reset two-factor authentication"
        size="sm"
      >
        {resetTarget && (
          <p className="text-sm text-warm-600">
            Reset two-factor authentication for{' '}
            <span className="font-semibold">{resetTarget.email}</span>? They will need to set it
            up again at their next sign-in.
          </p>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setResetTarget(null)} disabled={resetting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmReset} loading={resetting}>
            Confirm
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
