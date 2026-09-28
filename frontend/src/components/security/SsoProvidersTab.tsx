'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Badge, Button, Card, CardContent, FormError, Input, Modal, ModalFooter, Spinner } from '@/components/ui';
import { securityApi } from '@/lib/api-security';
import { SsoConfigInput, SsoProviderKey, SsoProviderView } from '@/types/security';

const PROVIDERS: { key: SsoProviderKey; label: string }[] = [
  { key: 'GOOGLE', label: 'Google' },
  { key: 'MICROSOFT', label: 'Microsoft' },
];

interface FormState {
  clientId: string;
  /** Left blank on edit; sent to the API only when the admin types something. */
  clientSecret: string;
  entraTenantId: string;
  enabled: boolean;
  allowedDomains: string;
  autoCreateUsers: boolean;
}

const emptyForm: FormState = {
  clientId: '',
  clientSecret: '',
  entraTenantId: '',
  enabled: false,
  allowedDomains: '',
  autoCreateUsers: false,
};

function toForm(view: SsoProviderView | undefined): FormState {
  if (!view) return { ...emptyForm };
  return {
    clientId: view.clientId,
    clientSecret: '',
    entraTenantId: view.entraTenantId ?? '',
    enabled: view.enabled,
    allowedDomains: view.allowedDomains.join(', '),
    autoCreateUsers: view.autoCreateUsers,
  };
}

function parseDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

function errorMessage(err: unknown, fallback: string): string {
  const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
  return typeof message === 'string' ? message : fallback;
}

/**
 * Single sign-on provider configuration — built by WS-3 (plan Task 3.6).
 * One card per provider (Google, Microsoft), each editable independently.
 */
export default function SsoProvidersTab() {
  const [views, setViews] = useState<Partial<Record<SsoProviderKey, SsoProviderView>>>({});
  const [forms, setForms] = useState<Record<SsoProviderKey, FormState>>({
    GOOGLE: { ...emptyForm },
    MICROSOFT: { ...emptyForm },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SsoProviderKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SsoProviderKey, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState<SsoProviderKey | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await securityApi.getSettings();
      const byProvider: Partial<Record<SsoProviderKey, SsoProviderView>> = {};
      for (const view of response.data.providers) {
        byProvider[view.provider] = view;
      }
      setViews(byProvider);
      setForms({
        GOOGLE: toForm(byProvider.GOOGLE),
        MICROSOFT: toForm(byProvider.MICROSOFT),
      });
    } catch {
      toast.error('Could not load SSO provider configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateForm = (provider: SsoProviderKey, patch: Partial<FormState>) => {
    setForms((current) => ({ ...current, [provider]: { ...current[provider], ...patch } }));
  };

  const handleSave = async (provider: SsoProviderKey) => {
    setErrors((current) => ({ ...current, [provider]: undefined }));
    setSaving(provider);
    const form = forms[provider];

    const body: SsoConfigInput = {
      clientId: form.clientId.trim(),
      enabled: form.enabled,
      allowedDomains: parseDomains(form.allowedDomains),
      autoCreateUsers: form.autoCreateUsers,
      ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
      ...(provider === 'MICROSOFT' ? { entraTenantId: form.entraTenantId.trim() } : {}),
    };

    try {
      const response = await securityApi.upsertSso(provider, body);
      setViews((current) => ({ ...current, [provider]: response.data }));
      setForms((current) => ({ ...current, [provider]: toForm(response.data) }));
      toast.success(`${provider === 'GOOGLE' ? 'Google' : 'Microsoft'} SSO configuration saved`);
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [provider]: errorMessage(err, 'Could not save this provider configuration.'),
      }));
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const provider = confirmDelete;
    setDeleting(true);
    try {
      await securityApi.deleteSso(provider);
      setViews((current) => ({ ...current, [provider]: undefined }));
      setForms((current) => ({ ...current, [provider]: { ...emptyForm } }));
      toast.success(`${provider === 'GOOGLE' ? 'Google' : 'Microsoft'} SSO configuration removed`);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not remove this provider configuration.'));
    } finally {
      setDeleting(false);
    }
  };

  const copyRedirectUri = async (uri: string) => {
    try {
      await navigator.clipboard.writeText(uri);
      toast.success('Redirect URI copied');
    } catch {
      toast.error('Could not copy the redirect URI');
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
      {PROVIDERS.map(({ key, label }) => {
        const view = views[key];
        const form = forms[key];
        return (
          <Card key={key}>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-warm-900">{label}</h3>
                {view?.hasClientSecret ? (
                  <Badge variant="success">Secret saved</Badge>
                ) : (
                  <Badge variant="gray">Not configured</Badge>
                )}
              </div>

              <Input
                label="Client ID"
                value={form.clientId}
                onChange={(e) => updateForm(key, { clientId: e.target.value })}
              />

              <Input
                label="Client secret"
                type="password"
                value={form.clientSecret}
                onChange={(e) => updateForm(key, { clientSecret: e.target.value })}
                placeholder={view?.hasClientSecret ? 'Leave blank to keep the current secret' : ''}
                autoComplete="new-password"
              />

              {key === 'MICROSOFT' && (
                <Input
                  label="Microsoft Entra tenant ID"
                  value={form.entraTenantId}
                  onChange={(e) => updateForm(key, { entraTenantId: e.target.value })}
                  placeholder="11111111-2222-3333-4444-555555555555"
                />
              )}

              <Input
                label="Allowed domains"
                value={form.allowedDomains}
                onChange={(e) => updateForm(key, { allowedDomains: e.target.value })}
                placeholder="acme.com, acme.co.in"
              />

              <label className="flex items-center gap-2 text-sm text-warm-700">
                <input
                  type="checkbox"
                  checked={form.autoCreateUsers}
                  onChange={(e) => updateForm(key, { autoCreateUsers: e.target.checked })}
                  className="h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500"
                />
                Automatically create accounts for matching employees
              </label>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-warm-700">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Enable ${label}`}
                    checked={form.enabled}
                    onChange={(e) => updateForm(key, { enabled: e.target.checked })}
                    className="h-5 w-9 rounded-full"
                  />
                  Enabled
                </label>
              </div>

              {view && (
                <div className="space-y-1">
                  <p className="label">Redirect URI</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-xs text-warm-600">
                      {view.redirectUri}
                    </code>
                    <Button type="button" variant="secondary" onClick={() => copyRedirectUri(view.redirectUri)}>
                      Copy
                    </Button>
                  </div>
                </div>
              )}

              {errors[key] && <FormError message={errors[key] as string} />}

              <div className="flex justify-between">
                {view ? (
                  <Button type="button" variant="secondary" onClick={() => setConfirmDelete(key)}>
                    Remove
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  onClick={() => handleSave(key)}
                  loading={saving === key}
                  disabled={saving === key}
                >
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Modal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Remove ${confirmDelete === 'GOOGLE' ? 'Google' : 'Microsoft'} SSO?`}
      >
        <div className="space-y-4">
          <p className="text-sm text-warm-600">
            Anyone signing in with this provider will no longer be able to. This cannot be undone from here.
          </p>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleDelete} loading={deleting} disabled={deleting}>
              Remove
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
}
