'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ApprovalCard } from '@/components/leave/ApprovalCard';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { leaveApi } from '@/lib/api';
import {
    RefreshCw,
    ClipboardCheck,
    Search,
    Filter,
    CheckCircle,
    XCircle,
    Clock,
    Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeaveRequest {
    id: string;
    leaveType: { name: string; code: string };
    employee: {
        id: string;
        firstName: string;
        lastName: string;
        employeeCode: string;
        department?: { name: string };
    };
    startDate: string;
    endDate: string;
    totalDays: number;
    status: string;
    reason?: string;
    createdAt: string;
}

export default function LeaveApprovalsPage() {
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [leaveTypeFilter, setLeaveTypeFilter] = useState('all');
    const [stats, setStats] = useState({
        pending: 0,
        approvedToday: 0,
        rejectedToday: 0,
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await leaveApi.getPendingApprovals();
            const pendingRequests = res.data || [];
            setRequests(pendingRequests);

            // Calculate stats
            setStats({
                pending: pendingRequests.length,
                approvedToday: 0, // Would need additional API to get this
                rejectedToday: 0,
            });
        } catch (error) {
            console.error('Failed to load approvals:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (id: string, note?: string) => {
        await leaveApi.approveRequest(id, note);
        await loadData();
    };

    const handleReject = async (id: string, note?: string) => {
        await leaveApi.rejectRequest(id, note);
        await loadData();
    };

    // Get unique leave types for filter
    const leaveTypes = [...new Set(requests.map(r => r.leaveType.code))];

    // Filter requests
    const filteredRequests = requests.filter(req => {
        const matchesSearch =
            req.employee.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            req.employee.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            req.employee.employeeCode.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesType = leaveTypeFilter === 'all' || req.leaveType.code === leaveTypeFilter;

        return matchesSearch && matchesType;
    });

    return (
        <DashboardLayout>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <ClipboardCheck className="w-7 h-7 text-primary-600" />
                            Leave Approvals
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Review and process leave requests from your team
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        onClick={loadData}
                        disabled={loading}
                    >
                        <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                        Refresh
                    </Button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="flex items-center gap-4">
                            <div className="p-3 bg-yellow-100 rounded-lg">
                                <Clock className="w-6 h-6 text-yellow-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-gray-900">{stats.pending}</div>
                                <div className="text-sm text-gray-500">Pending Requests</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-4">
                            <div className="p-3 bg-green-100 rounded-lg">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-gray-900">{stats.approvedToday}</div>
                                <div className="text-sm text-gray-500">Approved Today</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-4">
                            <div className="p-3 bg-red-100 rounded-lg">
                                <XCircle className="w-6 h-6 text-red-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-gray-900">{stats.rejectedToday}</div>
                                <div className="text-sm text-gray-500">Rejected Today</div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by employee name or code..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-gray-400" />
                        <select
                            value={leaveTypeFilter}
                            onChange={(e) => setLeaveTypeFilter(e.target.value)}
                            className="border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        >
                            <option value="all">All Leave Types</option>
                            {leaveTypes.map(type => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Approval Cards */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="text-center">
                            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent mx-auto" />
                            <p className="mt-4 text-gray-600">Loading pending approvals...</p>
                        </div>
                    </div>
                ) : filteredRequests.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                {requests.length === 0 ? 'No Pending Requests' : 'No Matching Requests'}
                            </h3>
                            <p className="text-gray-600">
                                {requests.length === 0
                                    ? "You don't have any leave requests waiting for approval."
                                    : 'Try adjusting your search or filter criteria.'}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredRequests.map((request) => (
                            <ApprovalCard
                                key={request.id}
                                request={request}
                                onApprove={handleApprove}
                                onReject={handleReject}
                            />
                        ))}
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
