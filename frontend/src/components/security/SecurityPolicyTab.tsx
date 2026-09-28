'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import axios from 'axios';
import { Button, Card, CardContent, FormError, Modal, ModalFooter, Spinner } from '@/components/ui';
import { securityApi } from '@/lib/api-security';
import { SecuritySettingsResponse } from '@/types/security';
import { UserRole } from '@/types';

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Super Admin',
  [UserRole.HR_ADMIN]: 'HR Admin',
  [UserRole.MANAGER]: 'Manager',
  [UserRole.EMPLOYEE]: 'Employee',
};

const ROLES = [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE];

function errorMessage(err: unknown, fallback: string): string {
  const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
  return typeof message === 'string' ? message : fallback;
}

/**
 * Two-factor and sign-in policy — built by WS-2 (plan Task 2.8). Per-role
 * 2FA requirement and the "Require SSO" break-glass toggle.
 */
export default function SecurityPolicyTab() {
  const [settings, setSettings] = useState<SecuritySettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [requireSso, setRequireSso] = useState(false);
  const [requiredRoles, setRequiredRoles] = useState<UserRole[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const requireSsoToggleId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await securityApi.getSettings();
      setSettings(response.data);
      setRequireSso(response.data.requireSso);
      setRequiredRoles(response.data.twoFactorRequiredRoles as UserRole[]);
    } catch {
      toast.error('Could not load the sign-in policy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasEnabledProvider = (settings?.providers ?? []).some((p) => p.enabled);

  const toggleRole = (role: UserRole) => {
    setRequiredRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );
  };

  const handleToggleRequireSso = () => {
    if (!hasEnabledProvider) return;
    if (!requireSso) {
      setConfirmOpen(true);
    } else {
      setRequireSso(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const response = await securityApi.updateSettings({
        requireSso,
        twoFactorRequiredRoles: requiredRoles,
      });
      setSettings(response.data);
      toast.success('Sign-in policy saved');
    } catch (err) {
      setError(errorMessage(err, 'Could not save the sign-in policy.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-warm-900">Require two-factor authentication</h3>
            <p className="text-sm text-warm-500">
              Users with a checked role will be asked to enrol at their next password sign-in.
              Sessions already open keep working until they expire.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-warm-700">
                <input
                  type="checkbox"
                  aria-label={ROLE_LABELS[role]}
                  checked={requiredRoles.includes(role)}
                  onChange={() => toggleRole(role)}
                  className="h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500"
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-warm-900">Require single sign-on</h3>
              <p className="text-sm text-warm-500">
                Only SUPER_ADMIN accounts can still sign in with a password, as a break-glass path.
              </p>
            </div>
            <label htmlFor={requireSsoToggleId} className="inline-flex items-center gap-2">
              <input
                id={requireSsoToggleId}
                aria-label="Require SSO"
                type="checkbox"
                role="switch"
                checked={requireSso}
                disabled={!hasEnabledProvider}
                onChange={handleToggleRequireSso}
                className="h-5 w-9 rounded-full disabled:opacity-50"
              />
            </label>
          </div>
          {!hasEnabledProvider && (
            <p className="text-xs text-warm-400">
              Enable at least one SSO provider on the Single sign-on tab before requiring it.
            </p>
          )}
        </CardContent>
      </Card>

      {error && <FormError message={error} />}

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} loading={saving} disabled={saving}>
          Save
        </Button>
      </div>

      <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Require single sign-on?">
        <div className="space-y-4">
          <p className="text-sm text-warm-600">
            Everyone except SUPER_ADMIN accounts will need to sign in through SSO. SUPER_ADMIN
            password sign-in always stays available as a break-glass path, so your organisation
            can never be fully locked out.
          </p>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setRequireSso(true);
                setConfirmOpen(false);
              }}
            >
              Confirm
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
}
