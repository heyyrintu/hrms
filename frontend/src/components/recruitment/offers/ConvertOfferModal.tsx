'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { onboardingApi } from '@/lib/api';
import {
  recruitmentApi,
  type Offer,
  type OfferConversionPayload,
  type OfferConversionResult,
} from '@/lib/api-recruitment';
import { apiErrorMessage, personName } from './offerFormat';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  offer: Offer;
  onConverted: (result: OfferConversionResult) => void;
}

/**
 * Accepted offer → employee. The server reuses the normal employee-creation
 * path, so the employee code is checked there (409 when taken).
 */
export function ConvertOfferModal({ isOpen, onClose, offer, onConverted }: Props) {
  const [employeeCode, setEmployeeCode] = useState('');
  const [createUser, setCreateUser] = useState(true);
  const [userEmail, setUserEmail] = useState(offer.candidate.email);
  const [userPassword, setUserPassword] = useState('');
  const [onboardingTemplateId, setOnboardingTemplateId] = useState('');
  const [templates, setTemplates] = useState<Array<{ value: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEmployeeCode('');
    setCreateUser(true);
    setUserEmail(offer.candidate.email);
    setUserPassword('');
    setOnboardingTemplateId('');
    let cancelled = false;
    onboardingApi
      .getTemplates()
      .then((res) => {
        if (cancelled) return;
        const raw = res.data as unknown;
        const rows = (Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? [])) as Array<{
          id: string;
          name: string;
          isActive?: boolean;
        }>;
        setTemplates(rows.filter((t) => t.isActive !== false).map((t) => ({ value: t.id, label: t.name })));
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, offer]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeCode.trim()) return toast.error('Enter an employee code');
    if (createUser && userPassword.length < 8) {
      return toast.error('The initial password needs at least 8 characters');
    }
    const payload: OfferConversionPayload = {
      employeeCode: employeeCode.trim(),
      createUser,
      ...(createUser ? { userEmail: userEmail.trim(), userPassword } : {}),
      onboardingTemplateId: onboardingTemplateId || null,
    };
    setSaving(true);
    try {
      const res = await recruitmentApi.convertOffer(offer.id, payload);
      toast.success(`${personName(offer.candidate)} is now an employee`);
      if (onboardingTemplateId && !res.data.onboardingProcessId) {
        toast.error('Onboarding could not be started; start it from the onboarding page');
      }
      onConverted(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Conversion failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Convert ${personName(offer.candidate)} to an employee`} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Input
          label="Employee code"
          value={employeeCode}
          onChange={(e) => setEmployeeCode(e.target.value)}
          maxLength={50}
          required
        />
        <label className="flex items-center gap-2 text-sm text-warm-700">
          <input
            type="checkbox"
            checked={createUser}
            onChange={(e) => setCreateUser(e.target.checked)}
          />
          Create a login for the new employee
        </label>
        {createUser && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Login e-mail"
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              required
            />
            <Input
              label="Initial password"
              type="password"
              autoComplete="new-password"
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
        )}
        <Select
          id="convert-onboarding-template"
          label="Onboarding template (optional)"
          placeholder="No onboarding process"
          options={templates}
          value={onboardingTemplateId}
          onChange={(e) => setOnboardingTemplateId(e.target.value)}
        />
        <p className="text-xs text-warm-500">
          Placement, employment type and joining date come from the offer. A salary is set up when the
          offer has a salary structure and base pay.
        </p>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Convert
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
