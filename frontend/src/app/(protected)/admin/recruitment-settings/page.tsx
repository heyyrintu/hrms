'use client';

import { useEffect, useState } from 'react';
import { Copy, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  recruitmentApi,
  type DocumentCategory,
  type PreOnboardingDocumentDefinition,
  type RecruitmentSettings,
} from '@/lib/api-recruitment';

const CATEGORY_OPTIONS: Array<{ value: DocumentCategory; label: string }> = [
  { value: 'ID_PROOF', label: 'ID proof' },
  { value: 'ADDRESS_PROOF', label: 'Address proof' },
  { value: 'EDUCATION', label: 'Education' },
  { value: 'EMPLOYMENT', label: 'Employment' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'TAX', label: 'Tax' },
  { value: 'OTHER', label: 'Other' },
];

const KEY_PATTERN = /^[a-z0-9_]{1,50}$/;

function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
}

/** Hiring settings: careers page switch, expiries, pre-onboarding checklist. */
export default function RecruitmentSettingsPage() {
  const [settings, setSettings] = useState<RecruitmentSettings | null>(null);
  const [careersPageEnabled, setCareersPageEnabled] = useState(false);
  const [careersIntro, setCareersIntro] = useState('');
  const [offerExpiryDays, setOfferExpiryDays] = useState('7');
  const [preOnboardingExpiryDays, setPreOnboardingExpiryDays] = useState('14');
  const [documents, setDocuments] = useState<PreOnboardingDocumentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await recruitmentApi.getSettings();
      applySettings(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load hiring settings'));
    } finally {
      setLoading(false);
    }
  };

  const applySettings = (data: RecruitmentSettings) => {
    setSettings(data);
    setCareersPageEnabled(data.careersPageEnabled);
    setCareersIntro(data.careersIntro ?? '');
    setOfferExpiryDays(String(data.offerExpiryDays));
    setPreOnboardingExpiryDays(String(data.preOnboardingExpiryDays));
    setDocuments(data.preOnboardingDocuments);
  };

  useEffect(() => {
    load();
  }, []);

  const addDocument = () => {
    setDocuments((prev) => [...prev, { key: '', label: '', category: 'OTHER', required: false }]);
  };

  const updateDocument = (index: number, patch: Partial<PreOnboardingDocumentDefinition>) => {
    setDocuments((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const removeDocument = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    for (const doc of documents) {
      if (!KEY_PATTERN.test(doc.key)) {
        toast.error(`"${doc.key}" must be lower-case letters, digits or underscores`);
        return;
      }
      if (!doc.label.trim()) {
        toast.error('Every checklist item needs a label');
        return;
      }
    }
    const keys = documents.map((d) => d.key);
    if (new Set(keys).size !== keys.length) {
      toast.error('Checklist keys must be unique');
      return;
    }

    setSaving(true);
    try {
      const res = await recruitmentApi.updateSettings({
        careersPageEnabled,
        careersIntro: careersIntro.trim() || null,
        offerExpiryDays: Number(offerExpiryDays),
        preOnboardingExpiryDays: Number(preOnboardingExpiryDays),
        preOnboardingDocuments: documents,
      });
      applySettings(res.data);
      toast.success('Hiring settings saved');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to save hiring settings'));
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.careersUrl);
      toast.success('Careers URL copied');
    } catch {
      toast.error('Could not copy the URL');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Hiring Settings</h1>
          <p className="text-warm-500">Careers page, offer and pre-onboarding link expiries, and the document checklist</p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <p className="text-warm-500">Loading...</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Careers page</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={careersPageEnabled}
                  onChange={(e) => setCareersPageEnabled(e.target.checked)}
                />
                <span>Publish the public careers page</span>
              </label>
              {settings && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-warm-600">{settings.careersUrl}</span>
                  <Button variant="secondary" size="sm" onClick={copyUrl}>
                    <Copy className="h-4 w-4 mr-1" /> Copy
                  </Button>
                </div>
              )}
              <div>
                <label htmlFor="careersIntro" className="label">
                  Intro shown at the top of the careers page (optional)
                </label>
                <textarea
                  id="careersIntro"
                  className="input min-h-[96px]"
                  maxLength={5000}
                  value={careersIntro}
                  onChange={(e) => setCareersIntro(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Link expiries</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Offer link expiry (days)"
                type="number"
                min={1}
                max={60}
                value={offerExpiryDays}
                onChange={(e) => setOfferExpiryDays(e.target.value)}
              />
              <Input
                label="Pre-onboarding link expiry (days)"
                type="number"
                min={1}
                max={30}
                value={preOnboardingExpiryDays}
                onChange={(e) => setPreOnboardingExpiryDays(e.target.value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pre-onboarding document checklist</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {documents.map((doc, index) => (
                <div key={index} className="grid grid-cols-1 gap-3 rounded-lg border border-warm-200 p-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                  <Input
                    label="Key"
                    value={doc.key}
                    placeholder="photo_id"
                    onChange={(e) => updateDocument(index, { key: e.target.value })}
                  />
                  <Input
                    label="Label"
                    value={doc.label}
                    onChange={(e) => updateDocument(index, { label: e.target.value })}
                  />
                  <Select
                    label="Category"
                    value={doc.category}
                    options={CATEGORY_OPTIONS}
                    onChange={(e) => updateDocument(index, { category: e.target.value as DocumentCategory })}
                  />
                  <label className="flex items-end gap-2 pb-2.5">
                    <input
                      type="checkbox"
                      checked={doc.required}
                      onChange={(e) => updateDocument(index, { required: e.target.checked })}
                    />
                    <span className="text-sm">Required</span>
                  </label>
                  <div className="flex items-end pb-1">
                    <Button variant="ghost" size="sm" onClick={() => removeDocument(index)} aria-label={`Remove ${doc.label || doc.key}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={addDocument}>
                <Plus className="h-4 w-4 mr-1" /> Add document
              </Button>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} loading={saving}>
              <Save className="h-4 w-4 mr-2" />
              Save settings
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
