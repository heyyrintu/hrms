'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
    IncomeTaxReferenceCard,
    ProfessionalTaxSlabsCard,
} from '@/components/statutory/SlabTables';
import {
    compareDecimals,
    formatMoney,
    formatPercent,
    isReadableDecimal,
    subtractDecimals,
    validateNumeric,
    type NumericKind,
} from '@/components/statutory/decimal';
import { statutoryApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type {
    IncomeTaxConfig,
    ProfessionalTaxSlab,
    StatutoryConfig,
    TaxRegimeName,
    UpdateStatutoryConfigPayload,
} from '@/types';
import {
    AlertCircle,
    Banknote,
    CalendarDays,
    HeartPulse,
    Info,
    Landmark,
    PiggyBank,
    Receipt,
    RefreshCw,
    Save,
    Scale,
    ShieldCheck,
    Sun,
    FolderCheck,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// The editable shape
// ---------------------------------------------------------------------------

/**
 * The form holds rates and amounts as the strings they arrived as. Nothing is
 * parsed into a number until the payload is built, so a value the user has not
 * touched goes back exactly as it came — or, better, is not sent at all.
 */
interface Draft {
    pfEnabled: boolean;
    pfEmployeeRate: string;
    pfEmployerRate: string;
    epsRate: string;
    pfWageCeiling: string;
    applyPfCeiling: boolean;
    edliRate: string;
    pfAdminRate: string;
    pfAdminMinimum: string;

    esiEnabled: boolean;
    esiEmployeeRate: string;
    esiEmployerRate: string;
    esiWageLimit: string;

    ptEnabled: boolean;
    ptState: string;

    lwfEnabled: boolean;
    lwfEmployeeAmount: string;
    lwfEmployerAmount: string;
    lwfMonths: number[];
    ptMonths: number[];

    gratuityEnabled: boolean;
    gratuityDaysPerYear: string;
    gratuityMonthDays: string;
    gratuityMinYears: string;
    gratuityExemptionCap: string;

    leaveEncashmentEnabled: boolean;
    encashmentMonthDays: string;
    encashmentExemptionCap: string;
    encashmentExemptDaysPerYear: string;
    encashmentExemptMonths: string;
    encashmentGovernmentEmployer: boolean;

    proofVerificationRequired: boolean;
    proofCutoffMonth: number;

    tdsEnabled: boolean;
    defaultTaxRegime: TaxRegimeName;
}

type NumericKey =
    | 'pfEmployeeRate'
    | 'pfEmployerRate'
    | 'epsRate'
    | 'pfWageCeiling'
    | 'edliRate'
    | 'pfAdminRate'
    | 'pfAdminMinimum'
    | 'esiEmployeeRate'
    | 'esiEmployerRate'
    | 'esiWageLimit'
    | 'lwfEmployeeAmount'
    | 'lwfEmployerAmount'
    | 'gratuityDaysPerYear'
    | 'gratuityMonthDays'
    | 'gratuityMinYears'
    | 'gratuityExemptionCap'
    | 'encashmentMonthDays'
    | 'encashmentExemptionCap'
    | 'encashmentExemptDaysPerYear'
    | 'encashmentExemptMonths';

type BooleanKey =
    | 'pfEnabled'
    | 'applyPfCeiling'
    | 'esiEnabled'
    | 'ptEnabled'
    | 'lwfEnabled'
    | 'gratuityEnabled'
    | 'leaveEncashmentEnabled'
    | 'encashmentGovernmentEmployer'
    | 'proofVerificationRequired'
    | 'tdsEnabled';

interface NumericField {
    key: NumericKey;
    /** Also the accessible name, and what a validation message names. */
    label: string;
    kind: NumericKind;
}

const NUMERIC_FIELDS: NumericField[] = [
    { key: 'pfEmployeeRate', label: 'PF employee share (%)', kind: 'percent' },
    { key: 'pfEmployerRate', label: 'PF employer share (%)', kind: 'percent' },
    { key: 'epsRate', label: 'Pension scheme (EPS) share (%)', kind: 'percent' },
    { key: 'pfWageCeiling', label: 'PF wage ceiling (₹)', kind: 'amount' },
    { key: 'edliRate', label: 'EDLI rate (%)', kind: 'percent' },
    { key: 'pfAdminRate', label: 'PF administration charges (%)', kind: 'percent' },
    { key: 'pfAdminMinimum', label: 'PF administration monthly minimum (₹)', kind: 'amount' },
    { key: 'esiEmployeeRate', label: 'ESI employee share (%)', kind: 'percent' },
    { key: 'esiEmployerRate', label: 'ESI employer share (%)', kind: 'percent' },
    { key: 'esiWageLimit', label: 'ESI wage limit (₹)', kind: 'amount' },
    { key: 'lwfEmployeeAmount', label: 'LWF employee amount (₹)', kind: 'amount' },
    { key: 'lwfEmployerAmount', label: 'LWF employer amount (₹)', kind: 'amount' },
    { key: 'gratuityDaysPerYear', label: 'Days of wages per completed year', kind: 'count' },
    { key: 'gratuityMonthDays', label: "Days treated as a month's wages", kind: 'count' },
    { key: 'gratuityMinYears', label: 'Minimum completed years', kind: 'count' },
    { key: 'gratuityExemptionCap', label: 'Section 10(10) exemption cap (₹)', kind: 'amount' },
    {
        key: 'encashmentMonthDays',
        label: "Days treated as a month's wages for encashment",
        kind: 'count',
    },
    {
        key: 'encashmentExemptionCap',
        label: 'Encashment exemption cap (₹)',
        kind: 'amount',
    },
    {
        key: 'encashmentExemptDaysPerYear',
        label: 'Exempt leave days per completed year',
        kind: 'count',
    },
    {
        key: 'encashmentExemptMonths',
        label: "Months of average salary the exemption allows",
        kind: 'count',
    },
];

const BOOLEAN_KEYS: BooleanKey[] = [
    'pfEnabled',
    'applyPfCeiling',
    'esiEnabled',
    'ptEnabled',
    'lwfEnabled',
    'gratuityEnabled',
    'leaveEncashmentEnabled',
    'encashmentGovernmentEmployer',
    'proofVerificationRequired',
    'tdsEnabled',
];

/** The months a proof cutoff can fall on, in financial-year order. */
const CUTOFF_MONTHS = [
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
];

/** The states whose professional tax slabs the seed ships. */
const PT_STATES = [
    'Karnataka',
    'Maharashtra',
    'West Bengal',
    'Telangana',
    'Andhra Pradesh',
    'Gujarat',
    'Madhya Pradesh',
];

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

/**
 * What the Acts say, offered as a starting point when there is no row yet.
 *
 * These are never written on the user's behalf: choosing setup fills the form
 * with them so every figure can be checked and then saved deliberately.
 */
const STATUTORY_DEFAULTS: Draft = {
    pfEnabled: true,
    pfEmployeeRate: '12',
    pfEmployerRate: '12',
    epsRate: '8.33',
    pfWageCeiling: '15000',
    applyPfCeiling: true,
    edliRate: '0.5',
    pfAdminRate: '0.5',
    pfAdminMinimum: '500',

    esiEnabled: true,
    esiEmployeeRate: '0.75',
    esiEmployerRate: '3.25',
    esiWageLimit: '21000',

    ptEnabled: true,
    ptState: 'Karnataka',

    lwfEnabled: false,
    lwfEmployeeAmount: '0',
    lwfEmployerAmount: '0',
    lwfMonths: [],
    ptMonths: [],

    gratuityEnabled: true,
    gratuityDaysPerYear: '15',
    gratuityMonthDays: '26',
    gratuityMinYears: '5',
    gratuityExemptionCap: '2000000',

    leaveEncashmentEnabled: true,
    encashmentMonthDays: '30',
    // Section 10(10AA): twenty-five lakh, thirty days a year, ten months.
    encashmentExemptionCap: '2500000',
    encashmentExemptDaysPerYear: '30',
    encashmentExemptMonths: '10',
    encashmentGovernmentEmployer: false,

    proofVerificationRequired: false,
    proofCutoffMonth: 1,

    tdsEnabled: true,
    defaultTaxRegime: 'NEW',
};

function draftFromConfig(config: StatutoryConfig): Draft {
    return {
        pfEnabled: config.pfEnabled,
        pfEmployeeRate: config.pfEmployeeRate,
        pfEmployerRate: config.pfEmployerRate,
        epsRate: config.epsRate,
        pfWageCeiling: config.pfWageCeiling,
        applyPfCeiling: config.applyPfCeiling,
        edliRate: config.edliRate,
        pfAdminRate: config.pfAdminRate,
        pfAdminMinimum: config.pfAdminMinimum,

        esiEnabled: config.esiEnabled,
        esiEmployeeRate: config.esiEmployeeRate,
        esiEmployerRate: config.esiEmployerRate,
        esiWageLimit: config.esiWageLimit,

        ptEnabled: config.ptEnabled,
        ptState: config.ptState ?? '',

        lwfEnabled: config.lwfEnabled,
        lwfEmployeeAmount: config.lwfEmployeeAmount,
        lwfEmployerAmount: config.lwfEmployerAmount,
        lwfMonths: [...config.lwfMonths].sort((a, b) => a - b),
        ptMonths: [...(config.ptMonths ?? [])].sort((a, b) => a - b),

        gratuityEnabled: config.gratuityEnabled,
        gratuityDaysPerYear: config.gratuityDaysPerYear,
        gratuityMonthDays: config.gratuityMonthDays,
        gratuityMinYears: config.gratuityMinYears,
        gratuityExemptionCap: config.gratuityExemptionCap,

        leaveEncashmentEnabled: config.leaveEncashmentEnabled,
        encashmentMonthDays: config.encashmentMonthDays,
        encashmentExemptionCap: config.encashmentExemptionCap,
        encashmentExemptDaysPerYear: config.encashmentExemptDaysPerYear,
        encashmentExemptMonths: config.encashmentExemptMonths,
        encashmentGovernmentEmployer: config.encashmentGovernmentEmployer,

        proofVerificationRequired: config.proofVerificationRequired,
        proofCutoffMonth: config.proofCutoffMonth,

        tdsEnabled: config.tdsEnabled,
        defaultTaxRegime: config.defaultTaxRegime,
    };
}

/**
 * A patch of what actually changed.
 *
 * With no baseline — the first save of a tenant that had no row — everything is
 * sent, because there is nothing to be unchanged from. Otherwise a rate that
 * differs only in trailing zeros is not a change and is not sent.
 */
function buildPayload(baseline: Draft | null, draft: Draft): UpdateStatutoryConfigPayload {
    const payload: Record<string, unknown> = {};

    for (const field of NUMERIC_FIELDS) {
        const next = draft[field.key];
        if (!baseline || compareDecimals(next, baseline[field.key]) !== 0) {
            payload[field.key] = Number(next);
        }
    }

    for (const key of BOOLEAN_KEYS) {
        if (!baseline || draft[key] !== baseline[key]) {
            payload[key] = draft[key];
        }
    }

    if (draft.ptState && (!baseline || draft.ptState !== baseline.ptState)) {
        payload.ptState = draft.ptState;
    }

    if (!baseline || draft.defaultTaxRegime !== baseline.defaultTaxRegime) {
        payload.defaultTaxRegime = draft.defaultTaxRegime;
    }

    if (!baseline || draft.proofCutoffMonth !== baseline.proofCutoffMonth) {
        payload.proofCutoffMonth = draft.proofCutoffMonth;
    }

    const ptMonths = [...draft.ptMonths].sort((a, b) => a - b);
    if (
        !baseline ||
        ptMonths.join(',') !== [...baseline.ptMonths].sort((a, b) => a - b).join(',')
    ) {
        payload.ptMonths = ptMonths;
    }

    const months = [...draft.lwfMonths].sort((a, b) => a - b);
    if (!baseline || months.join(',') !== [...baseline.lwfMonths].sort((a, b) => a - b).join(',')) {
        payload.lwfMonths = months;
    }

    return payload as UpdateStatutoryConfigPayload;
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function SectionCard({
    icon,
    title,
    statute,
    enabled,
    onToggle,
    toggleLabel,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    statute: string;
    enabled: boolean;
    onToggle: (value: boolean) => void;
    toggleLabel: string;
    children: React.ReactNode;
}) {
    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                            {icon}
                            {title}
                            <Badge variant={enabled ? 'success' : 'gray'}>
                                {enabled ? 'Applied' : 'Not applied'}
                            </Badge>
                        </CardTitle>
                        <p className="mt-1 text-xs text-warm-500">{statute}</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-warm-700">
                        <input
                            type="checkbox"
                            aria-label={toggleLabel}
                            checked={enabled}
                            onChange={(event) => onToggle(event.target.checked)}
                            className="h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
                        />
                        {toggleLabel}
                    </label>
                </div>
            </CardHeader>
            <CardContent className={cn('space-y-4', !enabled && 'opacity-60')}>
                {children}
            </CardContent>
        </Card>
    );
}

function Note({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-2 rounded-lg bg-sky-50 p-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-500" aria-hidden="true" />
            <div className="space-y-1 text-xs leading-relaxed text-sky-900">{children}</div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StatutoryConfigPage() {
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    /** Distinguishes "no row exists" from "not loaded yet". */
    const [hasConfig, setHasConfig] = useState(false);
    const [settingUp, setSettingUp] = useState(false);

    const [draft, setDraft] = useState<Draft>(STATUTORY_DEFAULTS);
    const [baseline, setBaseline] = useState<Draft | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<NumericKey, string>>>({});
    const [saving, setSaving] = useState(false);

    const [ptSlabs, setPtSlabs] = useState<ProfessionalTaxSlab[]>([]);
    const [ptSlabsLoading, setPtSlabsLoading] = useState(false);
    /** Which state the slabs in hand belong to, so a stale table is never shown as current. */
    const [ptSlabsState, setPtSlabsState] = useState<string | null>(null);
    const [incomeTaxConfigs, setIncomeTaxConfigs] = useState<IncomeTaxConfig[]>([]);
    const [incomeTaxLoading, setIncomeTaxLoading] = useState(true);

    const loadConfig = useCallback(async () => {
        setLoading(true);
        setLoadFailed(false);
        try {
            const res = await statutoryApi.getConfig();
            const config = (res?.data ?? null) as StatutoryConfig | null;
            if (config) {
                setHasConfig(true);
                setSettingUp(false);
                const next = draftFromConfig(config);
                setDraft(next);
                setBaseline(next);
            } else {
                // A real state, not a missing record: nothing is deducted.
                setHasConfig(false);
                setBaseline(null);
                setDraft(STATUTORY_DEFAULTS);
            }
        } catch (error) {
            console.error('Failed to load statutory configuration:', error);
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadIncomeTax = useCallback(async () => {
        setIncomeTaxLoading(true);
        try {
            const res = await statutoryApi.getIncomeTaxConfig();
            setIncomeTaxConfigs((res?.data ?? []) as IncomeTaxConfig[]);
        } catch (error) {
            console.error('Failed to load income tax configuration:', error);
            setIncomeTaxConfigs([]);
        } finally {
            setIncomeTaxLoading(false);
        }
    }, []);

    useEffect(() => {
        loadConfig();
        loadIncomeTax();
    }, [loadConfig, loadIncomeTax]);

    const ptState = draft.ptState;
    const showForm = hasConfig || settingUp;

    useEffect(() => {
        if (!showForm || !ptState) {
            setPtSlabs([]);
            setPtSlabsState(null);
            return;
        }
        let cancelled = false;
        setPtSlabsLoading(true);
        statutoryApi
            .getProfessionalTaxSlabs(ptState)
            .then((res) => {
                if (!cancelled) {
                    setPtSlabs((res?.data ?? []) as ProfessionalTaxSlab[]);
                    setPtSlabsState(ptState);
                }
            })
            .catch((error) => {
                console.error('Failed to load professional tax slabs:', error);
                if (!cancelled) {
                    setPtSlabs([]);
                    setPtSlabsState(ptState);
                }
            })
            .finally(() => {
                if (!cancelled) setPtSlabsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [showForm, ptState]);

    const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setDraft((current) => ({ ...current, [key]: value }));
        setFieldErrors((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key as NumericKey];
            return next;
        });
    };

    const toggleMonth = (field: 'lwfMonths' | 'ptMonths', month: number) => {
        setDraft((current) => ({
            ...current,
            [field]: current[field].includes(month)
                ? current[field].filter((m) => m !== month)
                : [...current[field], month].sort((a, b) => a - b),
        }));
    };

    const handleSave = async () => {
        // Refuse an unreadable or out-of-range entry here, naming the field. The
        // server would reject it too, but with a message that names nothing.
        const errors: Partial<Record<NumericKey, string>> = {};
        for (const field of NUMERIC_FIELDS) {
            const message = validateNumeric(draft[field.key], field.label, field.kind);
            if (message) errors[field.key] = message;
        }
        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            const first = NUMERIC_FIELDS.find((field) => errors[field.key]);
            if (first) toast.error(errors[first.key] as string);
            return;
        }
        setFieldErrors({});

        const payload = buildPayload(baseline, draft);
        if (Object.keys(payload).length === 0) {
            toast.success('Nothing has changed, so nothing was sent.');
            return;
        }

        setSaving(true);
        try {
            const res = await statutoryApi.updateConfig(payload);
            const saved = (res?.data ?? null) as StatutoryConfig | null;
            if (saved) {
                const next = draftFromConfig(saved);
                setDraft(next);
                setBaseline(next);
            } else {
                setBaseline(draft);
            }
            setHasConfig(true);
            setSettingUp(false);
            toast.success('Saved. It applies from the next payroll run.');
        } catch (error) {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message || 'Failed to save the statutory configuration';
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const numericInput = (key: NumericKey, help?: string) => {
        const field = NUMERIC_FIELDS.find((candidate) => candidate.key === key) as NumericField;
        return (
            <div>
                <Input
                    label={field.label}
                    aria-label={field.label}
                    // Deliberately a text box, not a number box: a number box hands
                    // back an empty string for an unreadable entry, and a rate nobody
                    // typed must never reach payroll.
                    type="text"
                    inputMode="decimal"
                    value={draft[key]}
                    onChange={(event) => setField(key, event.target.value)}
                    error={fieldErrors[key]}
                    disabled={saving}
                />
                {help ? <p className="mt-1 text-xs text-warm-500">{help}</p> : null}
            </div>
        );
    };

    // The remainder of the employer share once the pension scheme is carved out.
    const carveOutRemainder =
        isReadableDecimal(draft.pfEmployerRate) && isReadableDecimal(draft.epsRate)
            ? subtractDecimals(draft.pfEmployerRate.trim(), draft.epsRate.trim())
            : null;

    const header = (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-warm-900">
                    <Scale className="h-7 w-7 text-primary-600" aria-hidden="true" />
                    Statutory payroll
                </h1>
                <p className="mt-1 text-warm-600">
                    Which statutory levies apply to this tenant, and at what rates
                </p>
            </div>
            <div className="flex gap-3">
                <Button variant="secondary" onClick={loadConfig} disabled={loading || saving}>
                    <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                    Refresh
                </Button>
                {showForm ? (
                    <Button onClick={handleSave} loading={saving} disabled={saving}>
                        <Save className="mr-2 h-4 w-4" />
                        Save changes
                    </Button>
                ) : null}
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="space-y-6">
                {header}
                <div className="flex items-center justify-center py-20">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                </div>
            </div>
        );
    }

    if (loadFailed) {
        return (
            <div className="space-y-6">
                {header}
                <Card>
                    <CardContent className="py-12 text-center">
                        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-300" aria-hidden="true" />
                        <h2 className="text-lg font-semibold text-warm-900">
                            The statutory configuration could not be loaded
                        </h2>
                        <p className="mx-auto mt-1.5 max-w-md text-sm text-warm-600">
                            This is a failed request, not an answer about what is deducted.
                            Nothing has been changed. Try again.
                        </p>
                        <div className="mt-4 flex justify-center">
                            <Button onClick={loadConfig}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Try again
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!showForm) {
        return (
            <div className="space-y-6">
                {header}
                <Card>
                    <CardContent className="py-12">
                        <div className="mx-auto max-w-xl text-center">
                            <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-warm-300" aria-hidden="true" />
                            <h2 className="text-lg font-semibold text-warm-900">
                                Nothing statutory is deducted
                            </h2>
                            <p className="mt-2 text-sm leading-relaxed text-warm-600">
                                This tenant has no statutory configuration row. With none, no
                                provident fund, no state insurance, no professional tax, no labour
                                welfare fund and no tax at source come off anyone&apos;s pay, and
                                payroll behaves exactly as it did before this feature existed.
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-warm-600">
                                That is a deliberate state, not a missing record. Set it up when
                                you are ready to opt in.
                            </p>
                            <div className="mt-5 flex justify-center">
                                <Button onClick={() => setSettingUp(true)}>
                                    <Save className="mr-2 h-4 w-4" />
                                    Set up statutory deductions
                                </Button>
                            </div>
                            <p className="mt-3 text-xs text-warm-500">
                                Setting up opens a form filled with the rates in the Acts. Nothing
                                is written until you check every figure and save.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <IncomeTaxReferenceCard configs={incomeTaxConfigs} loading={incomeTaxLoading} />
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-4">
            {header}

            {settingUp ? (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" aria-hidden="true" />
                    <p className="text-xs leading-relaxed text-amber-900">
                        Nothing is saved yet. These are the rates in the Acts, offered as a
                        starting point — check every figure against what your establishment
                        actually pays before you save. Until you save, nothing statutory is
                        deducted.
                    </p>
                </div>
            ) : null}

            <div className="flex items-start gap-2 rounded-lg border border-warm-200 bg-warm-50 p-3">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-warm-400" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-warm-700">
                    A change here takes effect from the next payroll run. Runs already computed
                    are not recalculated, so a rate corrected after a run has been processed
                    will not change that run&apos;s payslips.
                </p>
            </div>

            {/* Provident fund ------------------------------------------------ */}
            <SectionCard
                icon={<PiggyBank className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                title="Provident fund"
                statute="Employees' Provident Funds and Miscellaneous Provisions Act 1952"
                enabled={draft.pfEnabled}
                onToggle={(value) => setField('pfEnabled', value)}
                toggleLabel="Deduct provident fund"
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {numericInput(
                        'pfEmployeeRate',
                        'Percent of PF wages, which is basic plus dearness allowance.',
                    )}
                    {numericInput('pfEmployerRate', 'Percent of PF wages, inclusive of the pension share.')}
                    {numericInput('epsRate', 'Carved out of the employer share above.')}
                </div>

                <Note>
                    <p>
                        The pension scheme is carved out of the employer&apos;s share, not added
                        to it.
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                        <div className="rounded-lg bg-white px-3 py-2 text-center">
                            <p className="text-sm font-semibold text-warm-900">
                                {formatPercent(draft.pfEmployerRate)}
                            </p>
                            <p className="text-[11px] text-warm-500">employer share</p>
                        </div>
                        <span className="text-sm text-warm-400">=</span>
                        <div className="rounded-lg bg-white px-3 py-2 text-center">
                            <p className="text-sm font-semibold text-warm-900">
                                {formatPercent(draft.epsRate)}
                            </p>
                            <p className="text-[11px] text-warm-500">to the pension scheme</p>
                        </div>
                        <span className="text-sm text-warm-400">+</span>
                        <div className="rounded-lg bg-white px-3 py-2 text-center">
                            <p className="text-sm font-semibold text-warm-900">
                                {carveOutRemainder === null ? '—' : formatPercent(carveOutRemainder)}
                            </p>
                            <p className="text-[11px] text-warm-500">to provident fund</p>
                        </div>
                    </div>
                    <p>
                        The pension share is always computed on wages capped at the ceiling, even
                        when you contribute on full wages, because that cap is statutory rather
                        than a matter of policy.
                    </p>
                </Note>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {numericInput(
                        'pfWageCeiling',
                        `Currently ${formatMoney(
                            isReadableDecimal(draft.pfWageCeiling) ? draft.pfWageCeiling : '0',
                        )} a month.`,
                    )}
                    <div className="flex items-start gap-3 pt-6">
                        <input
                            type="checkbox"
                            id="applyPfCeiling"
                            aria-label="Cap the employee and employer shares at the ceiling"
                            checked={draft.applyPfCeiling}
                            onChange={(event) => setField('applyPfCeiling', event.target.checked)}
                            disabled={saving}
                            className="mt-0.5 h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
                        />
                        <label htmlFor="applyPfCeiling" className="text-sm text-warm-700">
                            Cap the employee and employer shares at the ceiling
                            <span className="mt-1 block text-xs text-warm-500">
                                This governs only the employee and employer shares. Many employers
                                contribute on full wages; the pension share is capped either way.
                            </span>
                        </label>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {numericInput('edliRate', 'Employer cost, insurance under the EDLI scheme.')}
                    {numericInput('pfAdminRate', 'Employer cost, charged per employee.')}
                    {numericInput(
                        'pfAdminMinimum',
                        'A property of the establishment, applied when preparing the ECR rather than per employee.',
                    )}
                </div>
            </SectionCard>

            {/* State insurance ----------------------------------------------- */}
            <SectionCard
                icon={<HeartPulse className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                title="Employees' State Insurance"
                statute="Employees' State Insurance Act 1948"
                enabled={draft.esiEnabled}
                onToggle={(value) => setField('esiEnabled', value)}
                toggleLabel="Deduct state insurance"
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {numericInput('esiEmployeeRate', 'Percent of gross wages.')}
                    {numericInput('esiEmployerRate', 'Percent of gross wages.')}
                    {numericInput(
                        'esiWageLimit',
                        'Monthly gross at or below which an employee is covered.',
                    )}
                </div>
                <Note>
                    <p>
                        Crossing the wage limit mid-period does not end coverage. An employee who
                        contributed earlier in a contribution period keeps contributing until it
                        ends, which payroll works out from earlier payslips.
                    </p>
                </Note>
            </SectionCard>

            {/* Professional tax ---------------------------------------------- */}
            <SectionCard
                icon={<Landmark className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                title="Professional tax"
                statute="A state levy. Slabs are seeded per state."
                enabled={draft.ptEnabled}
                onToggle={(value) => setField('ptEnabled', value)}
                toggleLabel="Deduct professional tax"
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                        <Select
                            label="State"
                            aria-label="Professional tax state"
                            value={draft.ptState}
                            onChange={(event) => setField('ptState', event.target.value)}
                            disabled={saving}
                            options={PT_STATES.map((state) => ({ value: state, label: state }))}
                            placeholder="No state set"
                        />
                        <p className="mt-1 text-xs text-warm-500">
                            The slab table below is the one for this state.
                        </p>
                    </div>
                </div>
            </SectionCard>

            <ProfessionalTaxSlabsCard
                state={draft.ptState || null}
                slabs={ptSlabs}
                loading={ptSlabsLoading || ptSlabsState !== draft.ptState}
            />

            {/* Labour welfare fund -------------------------------------------- */}
            <SectionCard
                icon={<Banknote className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                title="Labour welfare fund"
                statute="A state levy, collected only in the months the state names."
                enabled={draft.lwfEnabled}
                onToggle={(value) => setField('lwfEnabled', value)}
                toggleLabel="Deduct labour welfare fund"
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {numericInput('lwfEmployeeAmount', 'A fixed amount, not a percentage.')}
                    {numericInput('lwfEmployerAmount', 'A fixed amount, not a percentage.')}
                </div>

                <fieldset className="rounded-lg border border-warm-200 p-3">
                    <legend className="px-1 text-sm font-medium text-warm-700">
                        Months this state collects professional tax in
                    </legend>
                    <p className="mb-2 text-xs text-warm-500">
                        Leave every month unticked if the state collects monthly, which most
                        do. Tick only the collection months for a half-yearly state, whose
                        slab amounts are period amounts rather than monthly ones.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {MONTHS.map((name, index) => {
                            const month = index + 1;
                            const checked = draft.ptMonths.includes(month);
                            return (
                                <label
                                    key={name}
                                    className={cn(
                                        'flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
                                        checked
                                            ? 'border-primary-300 bg-primary-50 text-primary-700'
                                            : 'border-warm-200 bg-white text-warm-600',
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        aria-label={`Professional tax collected in ${name}`}
                                        checked={checked}
                                        onChange={() => toggleMonth('ptMonths', month)}
                                        disabled={saving}
                                        className="h-3.5 w-3.5 rounded border-warm-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
                                    />
                                    {name.slice(0, 3)}
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                <fieldset className="rounded-lg border border-warm-200 p-3">
                    <legend className="px-1 text-sm font-medium text-warm-700">
                        Months the state collects in
                    </legend>
                    <p className="mb-2 text-xs text-warm-500">
                        Most states do not collect every month, so pick only the months yours
                        does. Nothing is deducted in an unticked month.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {MONTHS.map((name, index) => {
                            const month = index + 1;
                            const checked = draft.lwfMonths.includes(month);
                            return (
                                <label
                                    key={name}
                                    className={cn(
                                        'flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
                                        checked
                                            ? 'border-primary-300 bg-primary-50 text-primary-700'
                                            : 'border-warm-200 bg-white text-warm-600',
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        aria-label={`Labour welfare fund collected in ${name}`}
                                        checked={checked}
                                        onChange={() => toggleMonth('lwfMonths', month)}
                                        disabled={saving}
                                        className="h-3.5 w-3.5 rounded border-warm-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
                                    />
                                    {name.slice(0, 3)}
                                </label>
                            );
                        })}
                    </div>
                </fieldset>
            </SectionCard>

            {/* Gratuity -------------------------------------------------------- */}
            <SectionCard
                icon={<Receipt className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                title="Gratuity"
                statute="Payment of Gratuity Act 1972"
                enabled={draft.gratuityEnabled}
                onToggle={(value) => setField('gratuityEnabled', value)}
                toggleLabel="Compute gratuity"
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {numericInput('gratuityDaysPerYear', 'The Act says 15.')}
                    {numericInput(
                        'gratuityMonthDays',
                        'The Act says 26 for covered establishments.',
                    )}
                    {numericInput('gratuityMinYears', 'Completed years before any gratuity is payable.')}
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {numericInput('gratuityExemptionCap')}
                </div>
                <Note>
                    <p>
                        The section 10(10) figure caps the exempt part, never the amount payable.
                        Gratuity above it is still paid in full; only the excess is taxable. It
                        is not a maximum gratuity.
                    </p>
                </Note>
            </SectionCard>

            {/* Leave encashment ------------------------------------------------ */}
            <SectionCard
                icon={<Sun className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                title="Leave encashment"
                statute="Paid on exit for the leave balance that remains."
                enabled={draft.leaveEncashmentEnabled}
                onToggle={(value) => setField('leaveEncashmentEnabled', value)}
                toggleLabel="Compute leave encashment"
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {numericInput(
                        'encashmentMonthDays',
                        "Divides monthly wages into a day's wages for the encashment figure.",
                    )}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {numericInput('encashmentExemptionCap')}
                    {numericInput('encashmentExemptDaysPerYear', 'The Act says 30.')}
                    {numericInput('encashmentExemptMonths', 'The Act says 10.')}
                </div>

                <label className="flex items-start gap-2 text-sm text-warm-700">
                    <input
                        type="checkbox"
                        aria-label="Government employer"
                        checked={draft.encashmentGovernmentEmployer}
                        onChange={(event) =>
                            setField('encashmentGovernmentEmployer', event.target.checked)
                        }
                        disabled={saving}
                        className="mt-0.5 h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
                    />
                    <span>
                        Government employer
                        <span className="block text-xs text-warm-500">
                            Encashment paid by a government employer is exempt in full.
                        </span>
                    </span>
                </label>

                <Note>
                    <p>
                        The exemption is the least of four: what is received, this lifetime
                        ceiling less what earlier employers exempted, the months of average
                        salary above, and the days per completed year above. The cap here
                        caps the exempt part, not what is paid.
                    </p>
                </Note>
            </SectionCard>

            {/* Investment proofs ----------------------------------------------- */}
            <SectionCard
                icon={<FolderCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                title="Investment proofs"
                statute="Whether evidence is required before a declared deduction reduces TDS."
                enabled={draft.proofVerificationRequired}
                onToggle={(value) => setField('proofVerificationRequired', value)}
                toggleLabel="Require verified proofs"
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                        <Select
                            label="Month verified amounts take over"
                            aria-label="Month verified amounts take over"
                            value={String(draft.proofCutoffMonth)}
                            onChange={(event) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    proofCutoffMonth: Number(event.target.value),
                                }))
                            }
                            disabled={saving || !draft.proofVerificationRequired}
                            options={CUTOFF_MONTHS}
                        />
                        <p className="mt-1 text-xs text-warm-500">
                            Declarations stand on their own until this month, which is how
                            employers usually run the year: proofs are called in near its end.
                        </p>
                    </div>
                </div>
                <Note>
                    <p>
                        From the cutoff month, a head with no approved proof allows nothing
                        under that head, rather than the declared figure. That will raise the
                        tax deducted from every employee who has not had proofs approved,
                        which is the point of switching this on. It is off by default so that
                        nothing changes for anyone until somebody decides it should.
                    </p>
                </Note>
            </SectionCard>

            {/* TDS ------------------------------------------------------------- */}
            <SectionCard
                icon={<CalendarDays className="h-5 w-5 text-primary-600" aria-hidden="true" />}
                title="Tax deducted at source"
                statute="Income Tax Act, section 192"
                enabled={draft.tdsEnabled}
                onToggle={(value) => setField('tdsEnabled', value)}
                toggleLabel="Deduct TDS"
            >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                        <Select
                            label="Default tax regime"
                            aria-label="Default tax regime"
                            value={draft.defaultTaxRegime}
                            onChange={(event) =>
                                setField('defaultTaxRegime', event.target.value as TaxRegimeName)
                            }
                            disabled={saving}
                            options={[
                                { value: 'NEW', label: 'New regime' },
                                { value: 'OLD', label: 'Old regime' },
                            ]}
                        />
                        <p className="mt-1 text-xs text-warm-500">
                            Applied to employees who have not chosen a regime themselves. An
                            employee&apos;s own choice wins, then their declaration, then this.
                        </p>
                    </div>
                </div>
                <Note>
                    <p>
                        Slabs, the standard deduction, the section 87A rebate and the cess all
                        come from the seeded table for the financial year and regime, shown
                        below.
                    </p>
                </Note>
            </SectionCard>

            <IncomeTaxReferenceCard configs={incomeTaxConfigs} loading={incomeTaxLoading} />
        </div>
    );
}
