'use client';

/**
 * Accounting export configuration and journal preview/download (Keka wave C,
 * WS-C2). Three sections: export settings, the GL mapping table, and a run
 * picker that previews the journal before it is downloaded as CSV or Tally
 * XML. The role gate lives in the /payroll layout, so there is none here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Calculator, RefreshCw, Save } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { payrollApi } from '@/lib/api';
import {
  AccountingConfig,
  AccountingCostCenterMode,
  GlKnownKey,
  JournalPreview,
  payrollAccountingApi,
} from '@/lib/api-payroll-accounting';
import { GlMappingTable, MappingDraft } from '@/components/payroll/accounting/GlMappingTable';
import { JournalPreviewPanel } from '@/components/payroll/accounting/JournalPreviewPanel';
import { downloadBlob, monthLabel } from '@/components/payroll/accounting/money';

const serverMessage = (error: unknown, fallback: string): string =>
  (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

interface RunOption {
  id: string;
  month: number;
  year: number;
  runType: 'REGULAR' | 'OFF_CYCLE';
  sequence: number;
  status: string;
}

const costCenterOptions: { value: AccountingCostCenterMode; label: string }[] = [
  { value: 'NONE', label: 'No cost centre tracking' },
  { value: 'DEPARTMENT', label: 'By department' },
  { value: 'BRANCH', label: 'By branch' },
];

export default function PayrollAccountingPage() {
  const [config, setConfig] = useState<AccountingConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const [knownKeys, setKnownKeys] = useState<GlKnownKey[]>([]);
  const [mappingValues, setMappingValues] = useState<Record<string, MappingDraft>>({});
  const [savingMappings, setSavingMappings] = useState(false);
  const [loading, setLoading] = useState(true);

  const [runs, setRuns] = useState<RunOption[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [allowUnmapped, setAllowUnmapped] = useState(false);
  const [preview, setPreview] = useState<JournalPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloading, setDownloading] = useState<'csv' | 'tally' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, mappingsRes, runsRes] = await Promise.all([
        payrollAccountingApi.getConfig(),
        payrollAccountingApi.getGlMappings(),
        payrollApi.getRuns(),
      ]);
      setConfig(configRes.data);
      setKnownKeys(mappingsRes.data.knownKeys);
      const drafts: Record<string, MappingDraft> = {};
      for (const mapping of mappingsRes.data.mappings) {
        drafts[mapping.componentKey] = { glCode: mapping.glCode, glName: mapping.glName };
      }
      setMappingValues(drafts);
      const runList = (runsRes.data ?? []) as RunOption[];
      setRuns(runList);
      if (runList.length > 0) setSelectedRunId((current) => current || runList[0].id);
    } catch (error) {
      toast.error(serverMessage(error, 'The accounting settings could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runOptions = useMemo(
    () =>
      runs.map((run) => ({
        value: run.id,
        label: `${monthLabel(run.month, run.year)}${run.runType === 'OFF_CYCLE' ? ` · Off-cycle #${run.sequence}` : ''} · ${run.status}`,
      })),
    [runs],
  );

  const loadPreview = useCallback(async (runId: string, allow: boolean) => {
    if (!runId) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const response = await payrollAccountingApi.getJournal(runId, allow);
      setPreview(response.data);
    } catch (error) {
      setPreview(null);
      toast.error(serverMessage(error, 'The journal could not be built for this run.'));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreview(selectedRunId, allowUnmapped);
  }, [selectedRunId, allowUnmapped, loadPreview]);

  const saveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    try {
      const response = await payrollAccountingApi.updateConfig(config);
      setConfig(response.data);
      toast.success('Accounting settings saved.');
      await loadPreview(selectedRunId, allowUnmapped);
    } catch (error) {
      toast.error(serverMessage(error, 'The settings could not be saved.'));
    } finally {
      setSavingConfig(false);
    }
  };

  const onMappingChange = (key: string, field: keyof MappingDraft, value: string) => {
    setMappingValues((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { glCode: '', glName: '' }), [field]: value },
    }));
  };

  const saveMappings = async () => {
    const mappings = Object.entries(mappingValues)
      .filter(([, draft]) => draft.glCode.trim() !== '' && draft.glName.trim() !== '')
      .map(([componentKey, draft]) => ({ componentKey, glCode: draft.glCode.trim(), glName: draft.glName.trim() }));

    setSavingMappings(true);
    try {
      const response = await payrollAccountingApi.replaceGlMappings(mappings);
      setKnownKeys(response.data.knownKeys);
      toast.success('GL mappings saved.');
      await loadPreview(selectedRunId, allowUnmapped);
    } catch (error) {
      toast.error(serverMessage(error, 'The mappings could not be saved.'));
    } finally {
      setSavingMappings(false);
    }
  };

  const handleDownload = async (format: 'csv' | 'tally') => {
    if (!selectedRunId || !preview) return;
    setDownloading(format);
    try {
      const response = await payrollAccountingApi.exportJournal(selectedRunId, format, allowUnmapped);
      const stamp = `${preview.year}-${String(preview.month).padStart(2, '0')}`;
      const suffix = preview.runType === 'OFF_CYCLE' ? `-oc${preview.sequence}` : '';
      const filename = `journal-${stamp}${suffix}.${format === 'csv' ? 'csv' : 'xml'}`;
      downloadBlob(response.data as Blob, filename);
    } catch (error) {
      toast.error(serverMessage(error, 'The journal could not be exported.'));
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-warm-900 sm:text-2xl">
            <Calculator className="h-6 w-6 text-primary-600" aria-hidden="true" />
            Accounting export
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-warm-600">
            Map every payslip component to a GL account, then preview and download the journal voucher for
            a payroll run as CSV or Tally XML.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {config ? (
        <Card>
          <CardContent className="space-y-4">
            <h2 className="text-sm font-semibold text-warm-900">Export settings</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                label="Suspense GL code"
                value={config.suspenseGlCode ?? ''}
                onChange={(e) => setConfig({ ...config, suspenseGlCode: e.target.value })}
                placeholder="Optional"
              />
              <Input
                label="Suspense GL name"
                value={config.suspenseGlName ?? ''}
                onChange={(e) => setConfig({ ...config, suspenseGlName: e.target.value })}
                placeholder="Optional"
              />
              <Select
                label="Cost centre"
                value={config.costCenterMode}
                onChange={(e) => setConfig({ ...config, costCenterMode: e.target.value as AccountingCostCenterMode })}
                options={costCenterOptions}
              />
              <Input
                label="Tally company name"
                value={config.tallyCompanyName ?? ''}
                onChange={(e) => setConfig({ ...config, tallyCompanyName: e.target.value })}
                placeholder="Optional"
              />
              <Input
                label="Tally voucher type"
                value={config.tallyVoucherType}
                onChange={(e) => setConfig({ ...config, tallyVoucherType: e.target.value })}
              />
              <Input
                label="Narration template"
                value={config.narrationTemplate}
                onChange={(e) => setConfig({ ...config, narrationTemplate: e.target.value })}
              />
            </div>
            <p className="text-xs text-warm-500">
              Use <code>{'{{month}}'}</code> and <code>{'{{year}}'}</code> in the narration template.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => void saveConfig()} loading={savingConfig} disabled={savingConfig}>
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Save settings
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-warm-900">GL mappings</h2>
            <Button onClick={() => void saveMappings()} loading={savingMappings} disabled={savingMappings} size="sm">
              <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Save all mappings
            </Button>
          </div>
          <GlMappingTable knownKeys={knownKeys} values={mappingValues} onChange={onMappingChange} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-sm font-semibold text-warm-900">Journal preview and export</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Payroll run"
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              options={runOptions}
              placeholder={runs.length === 0 ? 'No payroll runs yet' : undefined}
            />
            <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-warm-700">
              <input
                type="checkbox"
                checked={allowUnmapped}
                onChange={(e) => setAllowUnmapped(e.target.checked)}
                className="h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500/20"
              />
              Post unmapped keys to the suspense account
            </label>
          </div>
          <JournalPreviewPanel
            preview={preview}
            loading={previewLoading}
            allowUnmapped={allowUnmapped}
            downloading={downloading}
            onDownload={handleDownload}
          />
        </CardContent>
      </Card>
    </div>
  );
}
