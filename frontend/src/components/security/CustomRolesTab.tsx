'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FormRow } from '@/components/ui/FormRow';
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
import { securityApi } from '@/lib/api-security';
import { CustomRoleView, PermissionDef } from '@/types/security';

interface RoleForm {
  name: string;
  description: string;
  permissions: string[];
}

const EMPTY_FORM: RoleForm = { name: '', description: '', permissions: [] };

/**
 * Custom roles — built by WS-1 (plan Task 1.6). List with user counts,
 * create/edit dialog with a permission picker grouped by `group`, delete
 * with a confirmation that names how many users would lose the role.
 */
export default function CustomRolesTab() {
  const [roles, setRoles] = useState<CustomRoleView[]>([]);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomRoleView | null>(null);
  const [form, setForm] = useState<RoleForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CustomRoleView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, permissionsRes] = await Promise.all([
        securityApi.getRoles(),
        securityApi.getPermissions(),
      ]);
      setRoles(rolesRes.data);
      setPermissions(permissionsRes.data);
    } catch {
      toast.error('Failed to load custom roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, PermissionDef[]>();
    for (const permission of permissions) {
      const list = byGroup.get(permission.group) ?? [];
      list.push(permission);
      byGroup.set(permission.group, list);
    }
    return Array.from(byGroup.entries());
  }, [permissions]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (role: CustomRoleView) => {
    setEditing(role);
    setForm({
      name: role.name,
      description: role.description ?? '',
      permissions: [...role.permissions],
    });
    setFormError(null);
    setModalOpen(true);
  };

  const togglePermission = (key: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      setFormError('Name is required');
      return;
    }
    if (form.permissions.length === 0) {
      setFormError('Select at least one permission');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const body = {
        name,
        description: form.description.trim() || undefined,
        permissions: form.permissions,
      };
      if (editing) {
        await securityApi.updateRole(editing.id, body);
        toast.success('Role updated');
      } else {
        await securityApi.createRole(body);
        toast.success('Role created');
      }
      setModalOpen(false);
      load();
    } catch (error: any) {
      setFormError(error.response?.data?.message || 'Failed to save the role');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await securityApi.deleteRole(deleteTarget.id);
      toast.success('Role deleted');
      setDeleteTarget(null);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete the role');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-warm-500">
          Named bundles of permissions granted on top of the fixed roles.
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add role
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Permissions</TableHead>
            <TableHead>Users</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoadingState colSpan={5} />
          ) : roles.length === 0 ? (
            <TableEmptyState message="No custom roles yet" colSpan={5} />
          ) : (
            roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell className="font-medium text-warm-900">{role.name}</TableCell>
                <TableCell className="text-warm-500">{role.description || '—'}</TableCell>
                <TableCell>{role.permissions.length}</TableCell>
                <TableCell>{role.userCount}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${role.name}`}
                      onClick={() => openEdit(role)}
                    >
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only sm:not-sr-only sm:ml-1">Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${role.name}`}
                      onClick={() => setDeleteTarget(role)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only sm:not-sr-only sm:ml-1">Delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit custom role' : 'Add custom role'}
        size="lg"
      >
        <FormRow label="Name" required>
          <Input
            aria-label="Name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            maxLength={80}
          />
        </FormRow>
        <FormRow label="Description">
          <Input
            aria-label="Description"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            maxLength={500}
          />
        </FormRow>

        <FormRow label="Permissions" required>
          <div className="space-y-4">
            {groups.map(([group, defs]) => (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wider text-warm-500 mb-1.5">
                  {group}
                </p>
                <div className="space-y-1.5">
                  {defs.map((permission) => (
                    <label key={permission.key} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={permission.label}
                        checked={form.permissions.includes(permission.key)}
                        onChange={() => togglePermission(permission.key)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="text-warm-900">{permission.label}</span>
                        <span className="block text-xs text-warm-500">{permission.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </FormRow>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete custom role"
        size="sm"
      >
        {deleteTarget && (
          <p className="text-sm text-warm-600">
            Delete <span className="font-semibold">{deleteTarget.name}</span>? This removes
            it from <span className="font-semibold">{deleteTarget.userCount}</span>{' '}
            {deleteTarget.userCount === 1 ? 'user' : 'users'}.
          </p>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} loading={deleting}>
            Confirm
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
