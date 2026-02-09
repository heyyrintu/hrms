'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { leaveApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    RefreshCw,
    BarChart3,
    Calendar,
    TrendingUp,
    Users,
    CheckCircle,
    XCircle,
    Clock,
    PieChart,
} from 'lucide-react';

interface Analytics {
    year: number;
    requestsByStatus: Record<string, number>;
    usageByType: Array<{
        leaveType: { id: string; name: string; code: string };
        totalDays: number;
        requestCount: number;
    }>;
    monthlyUsage: number[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function LeaveAnalyticsPage() {
    const [analytics, setAnalytics] = useState<Analytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

    useEffect(() => {
        loadData();
    }, [selectedYear]);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await leaveApi.getAnalytics(selectedYear);
            setAnalytics(res.data);
        } catch (error) {
            console.error('Failed to load analytics:', error);
        } finally {
            setLoading(false);
        }
    };

    const years = [
        new Date().getFullYear() - 1,
        new Date().getFullYear(),
        new Date().getFullYear() + 1,
    ];

    const totalRequests = analytics
        ? Object.values(analytics.requestsByStatus).reduce((a, b) => a + b, 0)
        : 0;

    const totalApprovedDays = analytics
        ? analytics.usageByType.reduce((a, b) => a + b.totalDays, 0)
        : 0;

    const maxMonthlyUsage = analytics
        ? Math.max(...analytics.monthlyUsage, 1)
        : 1;

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'APPROVED':
                return <CheckCircle className="w-5 h-5 text-green-500" />;
            case 'REJECTED':
                return <XCircle className="w-5 h-5 text-red-500" />;
            case 'PENDING':
                return <Clock className="w-5 h-5 text-yellow-500" />;
            case 'CANCELLED':
                return <XCircle className="w-5 h-5 text-gray-400" />;
            default:
                return <Clock className="w-5 h-5 text-gray-400" />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'APPROVED':
                return 'bg-green-100 text-green-800';
            case 'REJECTED':
                return 'bg-red-100 text-red-800';
            case 'PENDING':
                return 'bg-yellow-100 text-yellow-800';
            case 'CANCELLED':
                return 'bg-gray-100 text-gray-600';
            default:
                return 'bg-gray-100 text-gray-600';
        }
    };

    const getLeaveTypeColor = (code: string): string => {
        const colors: Record<string, string> = {
            'CL': 'bg-blue-500',
            'SL': 'bg-red-500',
            'PL': 'bg-green-500',
            'LOP': 'bg-gray-500',
            'ML': 'bg-pink-500',
            'PFL': 'bg-purple-500',
        };
        return colors[code] || 'bg-indigo-500';
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <BarChart3 className="w-7 h-7 text-primary-600" />
                            Leave Analytics
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Overview of leave usage and trends
                        </p>
                    </div>
                    <div className="flex gap-3 items-center">
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                            className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500"
                        >
                            {years.map(year => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : analytics ? (
                    <>
                        {/* Summary Stats */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <Card>
                                <CardContent className="flex items-center gap-4">
                                    <div className="p-3 bg-blue-100 rounded-lg">
                                        <Users className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <div>
                                        <div className="text-2xl font-bold text-gray-900">{totalRequests}</div>
                                        <div className="text-sm text-gray-500">Total Requests</div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="flex items-center gap-4">
                                    <div className="p-3 bg-green-100 rounded-lg">
                                        <CheckCircle className="w-6 h-6 text-green-600" />
                                    </div>
                                    <div>
                                        <div className="text-2xl font-bold text-gray-900">
                                            {analytics.requestsByStatus['APPROVED'] || 0}
                                        </div>
                                        <div className="text-sm text-gray-500">Approved</div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="flex items-center gap-4">
                                    <div className="p-3 bg-purple-100 rounded-lg">
                                        <Calendar className="w-6 h-6 text-purple-600" />
                                    </div>
                                    <div>
                                        <div className="text-2xl font-bold text-gray-900">{totalApprovedDays}</div>
                                        <div className="text-sm text-gray-500">Total Days Used</div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="flex items-center gap-4">
                                    <div className="p-3 bg-yellow-100 rounded-lg">
                                        <Clock className="w-6 h-6 text-yellow-600" />
                                    </div>
                                    <div>
                                        <div className="text-2xl font-bold text-gray-900">
                                            {analytics.requestsByStatus['PENDING'] || 0}
                                        </div>
                                        <div className="text-sm text-gray-500">Pending</div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Requests by Status */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <PieChart className="w-5 h-5 text-primary-600" />
                                        Requests by Status
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {Object.entries(analytics.requestsByStatus).map(([status, count]) => (
                                            <div key={status} className="flex items-center gap-3">
                                                {getStatusIcon(status)}
                                                <div className="flex-1">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-sm font-medium text-gray-700">{status}</span>
                                                        <span className="text-sm font-bold text-gray-900">{count}</span>
                                                    </div>
                                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className={cn(
                                                                'h-full rounded-full transition-all',
                                                                status === 'APPROVED' && 'bg-green-500',
                                                                status === 'REJECTED' && 'bg-red-500',
                                                                status === 'PENDING' && 'bg-yellow-500',
                                                                status === 'CANCELLED' && 'bg-gray-400',
                                                            )}
                                                            style={{ width: `${totalRequests ? (count / totalRequests) * 100 : 0}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Usage by Leave Type */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <TrendingUp className="w-5 h-5 text-primary-600" />
                                        Usage by Leave Type
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {analytics.usageByType.length === 0 ? (
                                        <p className="text-center text-gray-500 py-8">No approved leave data yet.</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {analytics.usageByType.map((item) => (
                                                <div key={item.leaveType.id} className="flex items-center gap-3">
                                                    <div className={cn(
                                                        'w-8 h-8 rounded flex items-center justify-center text-white text-xs font-bold',
                                                        getLeaveTypeColor(item.leaveType.code)
                                                    )}>
                                                        {item.leaveType.code}
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-sm font-medium text-gray-700">
                                                                {item.leaveType.name}
                                                            </span>
                                                            <span className="text-sm text-gray-500">
                                                                {item.totalDays} days ({item.requestCount} requests)
                                                            </span>
                                                        </div>
                                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                            <div
                                                                className={cn(
                                                                    'h-full rounded-full transition-all',
                                                                    getLeaveTypeColor(item.leaveType.code)
                                                                )}
                                                                style={{
                                                                    width: `${totalApprovedDays ? (item.totalDays / totalApprovedDays) * 100 : 0}%`
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* Monthly Usage Chart */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <BarChart3 className="w-5 h-5 text-primary-600" />
                                    Monthly Leave Usage
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-end gap-2 h-48">
                                    {analytics.monthlyUsage.map((days, index) => (
                                        <div key={index} className="flex-1 flex flex-col items-center gap-2">
                                            <div className="w-full flex items-end justify-center" style={{ height: '160px' }}>
                                                <div
                                                    className="w-full max-w-[60px] bg-gradient-to-t from-primary-600 to-primary-400 rounded-t transition-all hover:from-primary-700 hover:to-primary-500"
                                                    style={{
                                                        height: `${days > 0 ? Math.max((days / maxMonthlyUsage) * 100, 5) : 0}%`,
                                                        minHeight: days > 0 ? '8px' : '0',
                                                    }}
                                                    title={`${days} days`}
                                                />
                                            </div>
                                            <div className="text-xs text-gray-500">{MONTHS[index]}</div>
                                            {days > 0 && (
                                                <div className="text-xs font-medium text-gray-700">{days}</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </>
                ) : (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                No Analytics Data
                            </h3>
                            <p className="text-gray-600">
                                Leave data will appear here once employees start using the leave system.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </>
    );
}
