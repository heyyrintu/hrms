'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { leaveApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Calendar, Clock, FileText, AlertCircle, CheckCircle } from 'lucide-react';

interface LeaveType {
    id: string;
    name: string;
    code: string;
    description?: string;
    isPaid: boolean;
}

interface LeaveBalance {
    id: string;
    leaveType: { id: string; name: string; code: string };
    totalDays: number;
    usedDays: number;
    pendingDays: number;
    carriedOver: number;
}

interface LeaveRequestFormProps {
    onSuccess?: () => void;
    onCancel?: () => void;
}

export function LeaveRequestForm({ onSuccess, onCancel }: LeaveRequestFormProps) {
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Form state
    const [selectedTypeId, setSelectedTypeId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');
    const [isHalfDay, setIsHalfDay] = useState(false);
    const [halfDayPeriod, setHalfDayPeriod] = useState<'FIRST_HALF' | 'SECOND_HALF'>('FIRST_HALF');

    // Calculated values
    const [leaveDays, setLeaveDays] = useState(0);
    const [availableBalance, setAvailableBalance] = useState<number | null>(null);
    const [isInsufficientBalance, setIsInsufficientBalance] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (isHalfDay && startDate) {
            setLeaveDays(0.5);
        } else if (startDate && endDate) {
            const days = calculateLeaveDays(new Date(startDate), new Date(endDate));
            setLeaveDays(days);
        } else {
            setLeaveDays(0);
        }
    }, [startDate, endDate, isHalfDay]);

    useEffect(() => {
        if (selectedTypeId && balances.length > 0) {
            const balance = balances.find(b => b.leaveType.id === selectedTypeId);
            if (balance) {
                const available = balance.totalDays + balance.carriedOver - balance.usedDays - balance.pendingDays;
                setAvailableBalance(available);
                setIsInsufficientBalance(leaveDays > available);
            } else {
                setAvailableBalance(0);
                setIsInsufficientBalance(leaveDays > 0);
            }
        } else {
            setAvailableBalance(null);
            setIsInsufficientBalance(false);
        }
    }, [selectedTypeId, balances, leaveDays]);

    const loadData = async () => {
        try {
            const [typesRes, balancesRes] = await Promise.all([
                leaveApi.getTypes(),
                leaveApi.getMyBalances(),
            ]);
            setLeaveTypes(typesRes.data);
            setBalances(balancesRes.data);
        } catch (err) {
            console.error('Failed to load leave data:', err);
            setError('Failed to load leave types. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const calculateLeaveDays = (start: Date, end: Date): number => {
        if (start > end) return 0;

        let count = 0;
        const current = new Date(start);

        while (current <= end) {
            const dayOfWeek = current.getDay();
            // Exclude Saturday (6) and Sunday (0)
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                count++;
            }
            current.setDate(current.getDate() + 1);
        }

        return count;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            await leaveApi.createRequest({
                leaveTypeId: selectedTypeId,
                startDate,
                endDate: isHalfDay ? startDate : endDate,
                reason,
                ...(isHalfDay ? { isHalfDay: true, halfDayPeriod } : {}),
            });
            setSuccess(true);
            setTimeout(() => {
                onSuccess?.();
            }, 1500);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message :
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to submit leave request';
            setError(errorMessage);
        } finally {
            setSubmitting(false);
        }
    };

    const getSelectedLeaveType = () => {
        return leaveTypes.find(t => t.id === selectedTypeId);
    };

    const today = new Date().toISOString().split('T')[0];

    if (success) {
        return (
            <Card className="max-w-2xl mx-auto">
                <CardContent className="p-8">
                    <div className="text-center">
                        <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                            <CheckCircle className="w-8 h-8 text-emerald-600" />
                        </div>
                        <h3 className="text-xl font-semibold text-warm-900 mb-2">Leave Request Submitted!</h3>
                        <p className="text-warm-600">Your leave request has been submitted for approval.</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="max-w-2xl mx-auto">
            <CardHeader className="border-b border-warm-100 pb-4">
                <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary-600" />
                    Request Leave
                </CardTitle>
            </CardHeader>

            <CardContent className="pt-6">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Leave Type Selection */}
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-2">
                                Leave Type *
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {leaveTypes.map((type) => {
                                    const balance = balances.find(b => b.leaveType.id === type.id);
                                    const available = balance
                                        ? balance.totalDays + balance.carriedOver - balance.usedDays - balance.pendingDays
                                        : 0;

                                    return (
                                        <button
                                            key={type.id}
                                            type="button"
                                            onClick={() => setSelectedTypeId(type.id)}
                                            className={cn(
                                                'p-4 rounded-lg border-2 text-left transition-all',
                                                selectedTypeId === type.id
                                                    ? 'border-primary-600 bg-primary-50 ring-2 ring-primary-200'
                                                    : 'border-warm-200 hover:border-warm-300 hover:bg-warm-50'
                                            )}
                                        >
                                            <div className="font-medium text-warm-900">{type.name}</div>
                                            <div className="text-xs text-warm-500 mt-1">{type.code}</div>
                                            <div className={cn(
                                                'text-sm mt-2 font-semibold',
                                                available > 0 ? 'text-emerald-600' : 'text-red-600'
                                            )}>
                                                {available} days available
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Half-Day Toggle */}
                        <div className="flex items-center justify-between p-4 bg-warm-50 rounded-lg border border-warm-200">
                            <div>
                                <label className="text-sm font-medium text-warm-700">Half-Day Leave</label>
                                <p className="text-xs text-warm-500 mt-0.5">Request only half a working day</p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={isHalfDay}
                                onClick={() => {
                                    const next = !isHalfDay;
                                    setIsHalfDay(next);
                                    if (next && startDate) {
                                        setEndDate(startDate);
                                    }
                                }}
                                className={cn(
                                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                                    isHalfDay ? 'bg-primary-600' : 'bg-warm-300'
                                )}
                            >
                                <span
                                    className={cn(
                                        'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                                        isHalfDay ? 'translate-x-6' : 'translate-x-1'
                                    )}
                                />
                            </button>
                        </div>

                        {/* Half-Day Period Selector */}
                        {isHalfDay && (
                            <div>
                                <label className="block text-sm font-medium text-warm-700 mb-2">
                                    Half-Day Period *
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setHalfDayPeriod('FIRST_HALF')}
                                        className={cn(
                                            'p-3 rounded-lg border-2 text-center transition-all text-sm font-medium',
                                            halfDayPeriod === 'FIRST_HALF'
                                                ? 'border-primary-600 bg-primary-50 text-primary-700 ring-2 ring-primary-200'
                                                : 'border-warm-200 hover:border-warm-300 hover:bg-warm-50 text-warm-700'
                                        )}
                                    >
                                        First Half (Morning)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setHalfDayPeriod('SECOND_HALF')}
                                        className={cn(
                                            'p-3 rounded-lg border-2 text-center transition-all text-sm font-medium',
                                            halfDayPeriod === 'SECOND_HALF'
                                                ? 'border-primary-600 bg-primary-50 text-primary-700 ring-2 ring-primary-200'
                                                : 'border-warm-200 hover:border-warm-300 hover:bg-warm-50 text-warm-700'
                                        )}
                                    >
                                        Second Half (Afternoon)
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Date Range */}
                        <div className={cn('grid gap-4', isHalfDay ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
                            <div>
                                <label className="block text-sm font-medium text-warm-700 mb-2">
                                    {isHalfDay ? 'Date *' : 'Start Date *'}
                                </label>
                                <div className="relative">
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => {
                                            setStartDate(e.target.value);
                                            if (isHalfDay) {
                                                setEndDate(e.target.value);
                                            } else if (!endDate || e.target.value > endDate) {
                                                setEndDate(e.target.value);
                                            }
                                        }}
                                        min={today}
                                        className="w-full px-4 py-3 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                        required
                                    />
                                </div>
                            </div>

                            {!isHalfDay && (
                                <div>
                                    <label className="block text-sm font-medium text-warm-700 mb-2">
                                        End Date *
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            min={startDate || today}
                                            className="w-full px-4 py-3 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                            required
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Leave Days Summary */}
                        {leaveDays > 0 && (
                            <div className={cn(
                                'p-4 rounded-lg border',
                                isInsufficientBalance
                                    ? 'bg-red-50 border-red-200'
                                    : 'bg-blue-50 border-blue-200'
                            )}>
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        'p-2 rounded-full',
                                        isInsufficientBalance ? 'bg-red-100' : 'bg-blue-100'
                                    )}>
                                        <Clock className={cn(
                                            'w-5 h-5',
                                            isInsufficientBalance ? 'text-red-600' : 'text-blue-600'
                                        )} />
                                    </div>
                                    <div>
                                        <div className={cn(
                                            'font-semibold',
                                            isInsufficientBalance ? 'text-red-900' : 'text-blue-900'
                                        )}>
                                            {leaveDays} working day{leaveDays !== 1 ? 's' : ''} requested
                                            {isHalfDay && (
                                                <span className="ml-2 text-xs font-normal">
                                                    ({halfDayPeriod === 'FIRST_HALF' ? 'First Half' : 'Second Half'})
                                                </span>
                                            )}
                                        </div>
                                        <div className={cn(
                                            'text-sm',
                                            isInsufficientBalance ? 'text-red-700' : 'text-blue-700'
                                        )}>
                                            {isInsufficientBalance
                                                ? `Insufficient balance! Only ${availableBalance} days available.`
                                                : `You have ${availableBalance} days available for ${getSelectedLeaveType()?.name || 'this leave type'}.`
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Reason */}
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-2">
                                <FileText className="w-4 h-4 inline mr-1" />
                                Reason / Notes
                            </label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                rows={3}
                                placeholder="Enter the reason for your leave request..."
                                className="w-full px-4 py-3 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                            />
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                <div className="text-red-700">{error}</div>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-3 pt-4 border-t border-warm-100">
                            {onCancel && (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={onCancel}
                                    disabled={submitting}
                                >
                                    Cancel
                                </Button>
                            )}
                            <Button
                                type="submit"
                                loading={submitting}
                                disabled={!selectedTypeId || !startDate || (!isHalfDay && !endDate) || isInsufficientBalance}
                            >
                                Submit Request
                            </Button>
                        </div>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}
