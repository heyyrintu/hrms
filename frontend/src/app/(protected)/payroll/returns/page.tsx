'use client';

import { useEffect, useRef, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { payrollApi, returnsApi } from '@/lib/api';
import {
    GeneratedReturnFile,
    PayrollRun,
    PayrollRunStatus,
    StatutoryReturnKind,
} from '@/types';
import toast from 'react-hot-toast';
import {
    AlertTriangle,
    CheckCircle,
    Download,
    Eye,
    FileText,
    Landmark,
} from 'lucide-react';

const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** A run only holds real figures once it has been processed. */
const READY_STATUSES: PayrollRunStatus[] = [
    PayrollRunStatus.COMPUTED,
    PayrollRunStatus.APPROVED,
    PayrollRunStatus.PAID,
];

interface ReturnDefinition {
    kind: StatutoryReturnKind;
    title: string;
    /** What the file is for, in the words a payroll clerk would use. */
    description: string;
    /** Where this generated file can differ from what the portal expects. */
    caveat: string;
    /** Basename used when the file is fetched straight from the server. */
    slug: string;
}

const RETURN_DEFINITIONS: ReturnDefinition[] = [
    {
        kind: StatutoryReturnKind.PF_ECR,
        title: 'EPFO ECR',
        slug: 'pf-ecr',
        description:
            'The monthly Electronic Challan cum Return uploaded to the EPFO Unified Portal. One line per member with their UAN, wages and PF contributions for the month.',
        caveat:
            'The EPFO has revised the ECR layout more than once, and the version generated here may not match the template your establishment sees on the portal today. Open the preview next to your current ECR template and check the columns before you upload.',
    },
    {
        kind: StatutoryReturnKind.ESI,
        title: 'ESIC contribution',
        slug: 'esi',
        description:
            'The monthly contribution statement for the ESIC portal, covering employees whose wages fall within the ESI ceiling.',
        caveat:
            'Employees with no ESI number are left out of the file and named in the warnings. Add their numbers and generate again rather than filing a return that is short of people.',
    },
    {
        kind: StatutoryReturnKind.PROFESSIONAL_TAX,
        title: 'Professional tax challan',
        slug: 'professional-tax',
        description:
            'Professional tax deducted this month, totalled for the challan you pay to the state authority.',
        caveat:
            'Professional tax slabs, form numbers and filing frequency are set by each state and change from time to time. Confirm this month against the rules of the state you are paying in.',
    },
    {
        kind: StatutoryReturnKind.FORM_24Q,
        title: 'Form 24Q (TDS)',
        slug: 'form-24q',
        description:
            'Salary TDS detail for the quarterly Form 24Q return: one deductee row per employee with tax deducted this month.',
        caveat:
            'Every deductee row carries section code 92B. That is right for ordinary salary and wrong for a government employee, whose salary is 92A. Correct those rows by hand before you run the file through the FVU.',
    },
    {
        kind: StatutoryReturnKind.BANK_TRANSFER,
        title: 'Bank transfer file',
        slug: 'bank-transfer',
        description:
            'A salary disbursement file listing each employee’s account number, IFSC code and net pay, for bulk upload to your bank.',
        caveat:
            'This is a generic NEFT layout and banks differ. Check it against the bulk-upload specification your bank publishes, and reconcile the total before you authorise the payment.',
    },
];

const currencyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
});

/**
 * Money arrives from the backend as a decimal string (Prisma `Decimal`).
 * `Intl.NumberFormat` formats a decimal string exactly, so the figure is never
 * parsed into a float on the way to the screen.
 */
const formatCurrency = (value: string | number) =>
    currencyFormatter.format(value as unknown as number);

const runLabel = (run: PayrollRun) => `${monthNames[run.month]} ${run.year}`;

export default function StatutoryReturnsPage() {
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRunId, setSelectedRunId] = useState('');
    /**
     * The run the user is looking at right now.
     *
     * A preview already in flight when the selection changes still lands, and
     * the closure that started it holds the old id. Clearing held previews on
     * switch does not stop that. Without this the page can show one run's file
     * under another run's heading, which is a filing hazard rather than a
     * cosmetic one.
     */
    const selectedRunRef = useRef('');
    const [previews, setPreviews] = useState<Record<string, GeneratedReturnFile>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busyKind, setBusyKind] = useState<string | null>(null);

    useEffect(() => {
        loadRuns();
    }, []);

    const loadRuns = async () => {
        setLoading(true);
        try {
            const res = await payrollApi.getRuns();
            const loaded: PayrollRun[] = res.data ?? [];
            setRuns(loaded);
            const firstReady = loaded.find((run) => READY_STATUSES.includes(run.status));
            selectedRunRef.current = firstReady ? firstReady.id : '';
            setSelectedRunId(firstReady ? firstReady.id : '');
        } catch {
            toast.error('Failed to load payroll runs');
        } finally {
            setLoading(false);
        }
    };

    const readyRuns = runs.filter((run) => READY_STATUSES.includes(run.status));
    const unreadyRuns = runs.filter((run) => !READY_STATUSES.includes(run.status));
    const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

    const selectRun = (id: string) => {
        selectedRunRef.current = id;
        setSelectedRunId(id);
        // A preview belongs to the run it came from; do not carry it across.
        setPreviews({});
        setErrors({});
    };

    const failureMessage = (error: any) =>
        error?.response?.data?.message || error?.message || 'Something went wrong.';

    const handlePreview = async (def: ReturnDefinition) => {
        if (!selectedRunId) return;
        const runAtRequest = selectedRunId;
        setBusyKind(def.kind);
        setErrors((prev) => ({ ...prev, [def.kind]: '' }));
        try {
            const res = await returnsApi.preview(runAtRequest, def.kind);
            if (selectedRunRef.current !== runAtRequest) return;
            const file: GeneratedReturnFile = res.data;
            setPreviews((prev) => ({ ...prev, [def.kind]: file }));
        } catch (error: any) {
            // A failure for a run the user has moved on from is noise.
            if (selectedRunRef.current !== runAtRequest) return;
            const message = failureMessage(error);
            setErrors((prev) => ({ ...prev, [def.kind]: message }));
            toast.error(message);
        } finally {
            if (selectedRunRef.current === runAtRequest) setBusyKind(null);
        }
    };

    const handleDownload = async (def: ReturnDefinition) => {
        if (!selectedRunId || !selectedRun) return;
        setBusyKind(def.kind);
        setErrors((prev) => ({ ...prev, [def.kind]: '' }));
        try {
            const held = previews[def.kind];
            if (held) {
                // Already fetched: save what the user just read, unchanged.
                returnsApi.saveContent(held.content, held.filename, held.contentType);
            } else {
                const period = `${selectedRun.year}-${String(selectedRun.month).padStart(2, '0')}`;
                await returnsApi.download(
                    selectedRunId,
                    def.kind,
                    `${def.slug}-${period}.txt`,
                );
            }
        } catch (error: any) {
            const message = failureMessage(error);
            setErrors((prev) => ({ ...prev, [def.kind]: message }));
            toast.error(message);
        } finally {
            setBusyKind(null);
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
            {/* Header */}
            <div>
                <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
                    <Landmark className="w-7 h-7 text-primary-600" />
                    Statutory Returns
                </h1>
                <p className="text-warm-600 mt-1">
                    Generate the PF, ESI, professional tax, TDS and bank transfer files for a
                    processed payroll run.
                </p>
            </div>

            {/* The one thing a user must read before downloading anything */}
            <div
                role="note"
                className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 flex gap-3"
            >
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p className="font-semibold text-amber-900">
                        None of these files are ready to file as they are.
                    </p>
                    <p className="text-sm text-amber-900">
                        Each one is built from a generic template. Portal layouts, state rules and
                        bank formats change and differ. Preview every file, read the warnings, and
                        check it against the format your portal or bank publishes before you upload
                        or pay.
                    </p>
                </div>
            </div>

            {/* Run selector */}
            <Card>
                <CardContent className="py-4 space-y-3">
                    <Select
                        label="Payroll run"
                        value={selectedRunId}
                        onChange={(e) => selectRun(e.target.value)}
                    >
                        <option value="">Select a processed payroll run</option>
                        {runs.map((run) => {
                            const ready = READY_STATUSES.includes(run.status);
                            return (
                                <option key={run.id} value={run.id} disabled={!ready}>
                                    {ready
                                        ? `${runLabel(run)} — ${run.status}`
                                        : `${runLabel(run)} — ${run.status}, not available`}
                                </option>
                            );
                        })}
                    </Select>

                    {unreadyRuns.length > 0 && (
                        <p className="text-sm text-warm-600">
                            {`${unreadyRuns.length} payroll ${unreadyRuns.length === 1 ? 'run is' : 'runs are'} still in DRAFT or PROCESSING and cannot produce statutory files until ${unreadyRuns.length === 1 ? 'it is' : 'they are'} processed. Process the run from the Payroll page first.`}
                        </p>
                    )}

                    {readyRuns.length === 0 ? (
                        <div className="rounded-lg bg-warm-50 border border-warm-200 p-4">
                            <p className="font-semibold text-warm-900">
                                No payroll run is ready
                            </p>
                            <p className="text-sm text-warm-600 mt-1">
                                Statutory files are generated from computed payslips. Process a
                                payroll run and the files below become available.
                            </p>
                        </div>
                    ) : selectedRun ? (
                        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-1">
                            <div>
                                <p className="text-xs uppercase tracking-wide text-warm-500">
                                    Period
                                </p>
                                <p className="font-medium text-warm-900">
                                    {runLabel(selectedRun)}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-wide text-warm-500">
                                    Status
                                </p>
                                <Badge variant="info">{selectedRun.status}</Badge>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-wide text-warm-500">
                                    Employees
                                </p>
                                <p className="font-medium text-warm-900">
                                    {selectedRun.processedCount || selectedRun._count?.payslips || 0}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-wide text-warm-500">
                                    Net pay
                                </p>
                                <p className="font-medium text-emerald-700">
                                    {formatCurrency(selectedRun.totalNet)}
                                </p>
                            </div>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            {/* The five files */}
            <div className="space-y-4">
                {RETURN_DEFINITIONS.map((def) => {
                    const held = previews[def.kind];
                    const error = errors[def.kind];
                    const busy = busyKind === def.kind;
                    return (
                        <Card key={def.kind}>
                            <CardContent className="py-4 space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                    <div className="space-y-1">
                                        <h2 className="font-semibold text-warm-900 flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-primary-600" />
                                            {def.title}
                                        </h2>
                                        <p className="text-sm text-warm-600 max-w-3xl">
                                            {def.description}
                                        </p>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <Button
                                            variant="secondary"
                                            aria-label={`Preview ${def.title}`}
                                            disabled={!selectedRunId || busy}
                                            onClick={() => handlePreview(def)}
                                        >
                                            <Eye className="w-4 h-4 mr-2" />
                                            Preview
                                        </Button>
                                        <Button
                                            aria-label={`Download ${def.title}`}
                                            disabled={!selectedRunId || busy}
                                            onClick={() => handleDownload(def)}
                                        >
                                            <Download className="w-4 h-4 mr-2" />
                                            Download
                                        </Button>
                                    </div>
                                </div>

                                {/* Where this file can be wrong */}
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                                    <p className="text-sm text-amber-900">{def.caveat}</p>
                                </div>

                                {error && (
                                    <div className="rounded-lg border border-red-300 bg-red-50 p-3">
                                        <p role="alert" className="text-sm font-semibold text-red-800">
                                            {`Could not generate the ${def.title} file.`}
                                        </p>
                                        <p className="text-sm text-red-700 mt-1">{error}</p>
                                    </div>
                                )}

                                {held && (
                                    <div className="space-y-3">
                                        {held.warnings.length > 0 ? (
                                            <div
                                                role="alert"
                                                className="rounded-lg border-2 border-red-400 bg-red-50 p-3"
                                            >
                                                <p className="font-semibold text-red-900 flex items-center gap-2">
                                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                                    {`${held.warnings.length} ${held.warnings.length === 1 ? 'employee is' : 'employees are'} missing from this file`}
                                                </p>
                                                <p className="text-sm text-red-800 mt-1">
                                                    They were left out because the details a return
                                                    needs are missing. Fix the records and generate
                                                    the file again — filing without them is a defect
                                                    in the return.
                                                </p>
                                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                                    {held.warnings.map((warning, i) => (
                                                        <li
                                                            key={i}
                                                            className="text-sm text-red-900"
                                                        >
                                                            {warning}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : (
                                            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 flex gap-2">
                                                <CheckCircle className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                                                <p className="text-sm text-emerald-900">
                                                    No employee was left out of this file. Every
                                                    payslip in the run had the details this return
                                                    needs.
                                                </p>
                                            </div>
                                        )}

                                        <div className="rounded-lg border border-warm-200 bg-warm-50">
                                            <div className="flex items-center justify-between px-3 py-2 border-b border-warm-200">
                                                <p className="text-sm font-medium text-warm-800">
                                                    {held.filename}
                                                </p>
                                                <p className="text-xs text-warm-500">
                                                    Preview — read this before you file it
                                                </p>
                                            </div>
                                            <pre className="p-3 text-xs text-warm-800 overflow-x-auto max-h-64 whitespace-pre">
                                                {held.content}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
