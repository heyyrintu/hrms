'use client';

import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { IncomeTaxConfig, ProfessionalTaxSlab } from '@/types';
import { FileText, Landmark, Lock } from 'lucide-react';

import { financialYearLabel, formatMoney, formatPercent } from './decimal';

/**
 * Slab tables are reference, not settings.
 *
 * Professional tax slabs and income tax slabs are seeded per state and per
 * financial year. There is no endpoint that edits them, so nothing here
 * pretends to: the tables render read-only and say how they are actually
 * changed.
 */

function SeedNote() {
    return (
        <p className="text-xs leading-relaxed text-warm-500">
            These are seeded rows, not settings. To change them, edit the seed data and
            run{' '}
            <code className="rounded bg-warm-100 px-1 py-0.5 font-mono text-[11px] text-warm-700">
                npm run prisma:seed-statutory
            </code>
            , which is documented in{' '}
            <code className="rounded bg-warm-100 px-1 py-0.5 font-mono text-[11px] text-warm-700">
                docs/india-statutory-payroll.md
            </code>
            .
        </p>
    );
}

function ReadOnlyBadge() {
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-warm-100 px-2.5 py-0.5 text-xs font-semibold text-warm-600 ring-1 ring-inset ring-warm-200">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Read only
        </span>
    );
}

/** `'0.00'` to `'24999.00'` reads as one range, so no bound stands alone. */
function rangeLabel(fromAmount: string, toAmount: string | null): string {
    if (toAmount === null) return `${formatMoney(fromAmount)} and above`;
    return `${formatMoney(fromAmount)} – ${formatMoney(toAmount)}`;
}

// ---------------------------------------------------------------------------
// Professional tax
// ---------------------------------------------------------------------------

interface ProfessionalTaxSlabsProps {
    state: string | null;
    slabs: ProfessionalTaxSlab[];
    loading: boolean;
}

export function ProfessionalTaxSlabsCard({
    state,
    slabs,
    loading,
}: ProfessionalTaxSlabsProps) {
    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Landmark className="h-5 w-5 text-primary-600" aria-hidden="true" />
                        Professional tax slabs
                        {state ? <Badge variant="info">{state}</Badge> : null}
                    </CardTitle>
                    <ReadOnlyBadge />
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {!state ? (
                    <p className="text-sm text-warm-600">
                        No state is set for professional tax, so there is no slab table to
                        show. Choose a state above and save to see its slabs.
                    </p>
                ) : loading ? (
                    <p className="text-sm text-warm-500">Loading slabs…</p>
                ) : slabs.length === 0 ? (
                    <p className="text-sm text-warm-600">
                        No professional tax slabs are seeded for {state}. No professional tax
                        is deducted without them; no figure is invented in their place.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table
                            aria-label={`Professional tax slabs for ${state}`}
                            className="w-full text-sm"
                        >
                            <thead>
                                <tr className="border-b border-warm-200 text-left text-xs uppercase tracking-wide text-warm-500">
                                    <th className="py-2 pr-4 font-medium">Monthly wages</th>
                                    <th className="py-2 pr-4 font-medium">Tax per month</th>
                                    <th className="py-2 pr-4 font-medium">February</th>
                                    <th className="py-2 font-medium">Applies to</th>
                                </tr>
                            </thead>
                            <tbody>
                                {slabs.map((slab) => (
                                    <tr key={slab.id} className="border-b border-warm-100 last:border-0">
                                        <td className="py-2 pr-4 text-warm-800">
                                            {rangeLabel(slab.fromAmount, slab.toAmount)}
                                        </td>
                                        <td className="py-2 pr-4 font-medium text-warm-900">
                                            {formatMoney(slab.amount)}
                                        </td>
                                        <td className="py-2 pr-4 text-warm-600">
                                            {slab.februaryAmount === null
                                                ? 'Same'
                                                : formatMoney(slab.februaryAmount)}
                                        </td>
                                        <td className="py-2 text-warm-600">
                                            {slab.gender === null ? 'Everyone' : slab.gender}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <SeedNote />
            </CardContent>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Income tax
// ---------------------------------------------------------------------------

interface IncomeTaxReferenceProps {
    configs: IncomeTaxConfig[];
    loading: boolean;
}

function Parameter({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg bg-warm-50 px-3 py-2">
            <p className="text-xs text-warm-500">{label}</p>
            <p className="mt-0.5 text-sm font-medium text-warm-900">{value}</p>
        </div>
    );
}

export function IncomeTaxReferenceCard({ configs, loading }: IncomeTaxReferenceProps) {
    const years = Array.from(new Set(configs.map((c) => c.financialYear))).sort(
        (a, b) => b - a,
    );

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <FileText className="h-5 w-5 text-primary-600" aria-hidden="true" />
                        Income tax slabs
                    </CardTitle>
                    <ReadOnlyBadge />
                </div>
            </CardHeader>
            <CardContent className="space-y-5">
                {loading ? (
                    <p className="text-sm text-warm-500">Loading slabs…</p>
                ) : configs.length === 0 ? (
                    <p className="text-sm text-warm-700">
                        No income tax slabs are configured. No TDS is deducted for a financial
                        year without slabs, rather than a figure being guessed.
                    </p>
                ) : (
                    years.map((year) => (
                        <div key={year} className="space-y-3">
                            <h3 className="text-sm font-semibold text-warm-900">
                                {financialYearLabel(year)}
                            </h3>
                            {configs
                                .filter((c) => c.financialYear === year)
                                .map((config) => (
                                    <div
                                        key={config.id}
                                        className="space-y-3 rounded-xl border border-warm-200 p-3"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Badge variant={config.regime === 'NEW' ? 'default' : 'gray'}>
                                                {config.regime === 'NEW' ? 'New regime' : 'Old regime'}
                                            </Badge>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                                            <Parameter
                                                label="Standard deduction"
                                                value={formatMoney(config.standardDeduction)}
                                            />
                                            <Parameter
                                                label="Section 87A rebate limit"
                                                value={formatMoney(config.rebateIncomeLimit)}
                                            />
                                            <Parameter
                                                label="Section 87A rebate amount"
                                                value={formatMoney(config.rebateMaxAmount)}
                                            />
                                            <Parameter
                                                label="Health and education cess"
                                                value={formatPercent(config.cessRate)}
                                            />
                                        </div>

                                        {config.slabs.length === 0 ? (
                                            <p className="text-sm text-warm-700">
                                                No slabs are configured for this year and regime. No TDS is
                                                deducted without them, rather than a figure being guessed.
                                            </p>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <table
                                                    aria-label={`Income tax slabs for ${financialYearLabel(
                                                        year,
                                                    )}, ${config.regime} regime`}
                                                    className="w-full text-sm"
                                                >
                                                    <thead>
                                                        <tr className="border-b border-warm-200 text-left text-xs uppercase tracking-wide text-warm-500">
                                                            <th className="py-2 pr-4 font-medium">Taxable income</th>
                                                            <th className="py-2 font-medium">Rate</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {config.slabs.map((slab) => (
                                                            <tr
                                                                key={slab.id}
                                                                className="border-b border-warm-100 last:border-0"
                                                            >
                                                                <td className="py-2 pr-4 text-warm-800">
                                                                    {slab.toAmount === null
                                                                        ? `Above ${formatMoney(slab.fromAmount)}`
                                                                        : rangeLabel(slab.fromAmount, slab.toAmount)}
                                                                </td>
                                                                <td className="py-2 font-medium text-warm-900">
                                                                    {formatPercent(slab.rate)}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                ))}
                        </div>
                    ))
                )}
                <SeedNote />
            </CardContent>
        </Card>
    );
}
