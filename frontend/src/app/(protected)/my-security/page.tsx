'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ShieldCheck, ShieldOff, KeyRound } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Modal,
  ModalFooter,
  Input,
  FormError,
  Spinner,
} from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { twoFactorApi } from '@/lib/api-security';
import { TwoFactorStatus } from '@/types/security';
import { AuthResponse } from '@/types';
import TotpEnrolment from '@/components/auth/TotpEnrolment';
import RecoveryCodes from '@/components/auth/RecoveryCodes';

type View =
  | { name: 'status' }
  | { name: 'enable-setup' }
  | { name: 'enable-codes'; recoveryCodes: string[]; session: AuthResponse }
  | { name: 'regenerate-codes'; recoveryCodes: string[] };

function errorMessage(err: unknown, fallback: string): string {
  const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
  return typeof message === 'string' ? message : fallback;
}

/**
 * Everyone's own 2FA management: status, enable, disable, regenerate
 * recovery codes. Owned by WS-2 (plan Task 2.8).
 */
export default function MySecurityPage() {
  const { completeSession } = useAuth();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ name: 'status' });

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState('');
  const [disableSubmitting, setDisableSubmitting] = useState(false);

  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerateCode, setRegenerateCode] = useState('');
  const [regenerateError, setRegenerateError] = useState('');
  const [regenerateSubmitting, setRegenerateSubmitting] = useState(false);

  const loadStatus = async () => {
    const response = await twoFactorApi.status();
    setStatus(response.data);
  };

  useEffect(() => {
    (async () => {
      try {
        await loadStatus();
      } catch {
        toast.error('Could not load your two-factor status');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableError('');
    setDisableSubmitting(true);
    try {
      const response = await twoFactorApi.disable(disablePassword, disableCode);
      // The old token's tokenVersion is now stale: disable() bumped it server-side.
      completeSession(response.data);
      toast.success('Two-factor authentication disabled');
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      await loadStatus();
    } catch (err) {
      setDisableError(errorMessage(err, 'Could not disable two-factor authentication.'));
    } finally {
      setDisableSubmitting(false);
    }
  };

  const handleRegenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenerateError('');
    setRegenerateSubmitting(true);
    try {
      const response = await twoFactorApi.regenerateRecoveryCodes(regenerateCode);
      setRegenerateOpen(false);
      setRegenerateCode('');
      setView({ name: 'regenerate-codes', recoveryCodes: response.data.recoveryCodes });
    } catch (err) {
      setRegenerateError(errorMessage(err, 'Could not regenerate your recovery codes.'));
    } finally {
      setRegenerateSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (view.name === 'enable-setup') {
    return (
      <div className="max-w-2xl">
        <TotpEnrolment
          onEnabled={(result) =>
            setView({ name: 'enable-codes', recoveryCodes: result.recoveryCodes, session: result.session })
          }
        />
      </div>
    );
  }

  if (view.name === 'enable-codes') {
    return (
      <div className="max-w-2xl">
        <RecoveryCodes
          codes={view.recoveryCodes}
          onContinue={async () => {
            // Enabling bumps tokenVersion and signs out every other session;
            // this session's own token is stale too until it is replaced.
            completeSession(view.session);
            toast.success('Two-factor authentication enabled');
            setView({ name: 'status' });
            await loadStatus();
          }}
        />
      </div>
    );
  }

  if (view.name === 'regenerate-codes') {
    return (
      <div className="max-w-2xl">
        <RecoveryCodes
          codes={view.recoveryCodes}
          onContinue={() => setView({ name: 'status' })}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-warm-900">My security</h1>
        <p className="text-sm text-warm-500">Manage two-factor authentication for your account.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status?.enabled ? (
              <ShieldCheck className="h-5 w-5 text-green-600" aria-hidden="true" />
            ) : (
              <ShieldOff className="h-5 w-5 text-warm-400" aria-hidden="true" />
            )}
            Two-factor authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-warm-600">
            {status?.enabled
              ? `Enabled${status.enabledAt ? ` on ${new Date(status.enabledAt).toLocaleDateString()}` : ''}.`
              : 'Not enabled. Add an authenticator app for a second sign-in step.'}
          </p>
          {status?.required && !status.enabled && (
            <p className="text-sm text-amber-600">
              Your role requires two-factor authentication — you will be asked to enrol at your
              next sign-in.
            </p>
          )}
          {status?.enabled && (
            <p className="text-sm text-warm-500">
              Recovery codes remaining: {status.recoveryCodesRemaining}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!status?.enabled && (
              <Button type="button" onClick={() => setView({ name: 'enable-setup' })}>
                Enable two-factor authentication
              </Button>
            )}
            {status?.enabled && (
              <>
                <Button type="button" variant="secondary" onClick={() => setRegenerateOpen(true)}>
                  <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Regenerate recovery codes
                </Button>
                {!status.required && (
                  <Button type="button" variant="danger" onClick={() => setDisableOpen(true)}>
                    Disable two-factor authentication
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Modal isOpen={disableOpen} onClose={() => setDisableOpen(false)} title="Disable two-factor authentication">
        <form onSubmit={handleDisable} className="space-y-4">
          {disableError && <FormError message={disableError} />}
          <Input
            label="Password"
            type="password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <Input
            label="Authentication code"
            type="text"
            inputMode="numeric"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            maxLength={6}
            required
            autoComplete="one-time-code"
          />
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={disableSubmitting} disabled={disableSubmitting}>
              Confirm
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal isOpen={regenerateOpen} onClose={() => setRegenerateOpen(false)} title="Regenerate recovery codes">
        <form onSubmit={handleRegenerate} className="space-y-4">
          <p className="text-sm text-warm-500">Your existing recovery codes will stop working.</p>
          {regenerateError && <FormError message={regenerateError} />}
          <Input
            label="Authentication code"
            type="text"
            inputMode="numeric"
            value={regenerateCode}
            onChange={(e) => setRegenerateCode(e.target.value)}
            maxLength={6}
            required
            autoComplete="one-time-code"
          />
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setRegenerateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={regenerateSubmitting} disabled={regenerateSubmitting}>
              Confirm
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
