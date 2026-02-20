'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { ApprovalCard } from '@/components/leave/ApprovalCard';
import { BulkApprovalBar } from '@/components/leave/BulkApprovalBar';
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
    const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'week' | 'month'>('all');
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkActionLoading, setBulkActionLoading] = useState(false);
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
        try {
            await leaveApi.approveRequest(id, note);
            toast.success('Leave request approved');
            await loadData();
        } catch (error: any) {
            const message = error.response?.data?.message || 'Failed to approve leave request';
            toast.error(message);
        }
    };

    const handleReject = async (id: string, note?: string) => {
        try {
            await leaveApi.rejectRequest(id, note);
            toast.success('Leave request rejected');
            await loadData();
        } catch (error: any) {
            const message = error.response?.data?.message || 'Failed to reject leave request';
            toast.error(message);
        }
    };

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleSelectAll = () => {
        if (selectedIds.length === filteredRequests.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredRequests.map(r => r.id));
        }
    };

    const handleBulkApprove = async () => {
        setBulkActionLoading(true);
        try {
            await Promise.all(selectedIds.map(id => leaveApi.approveRequest(id)));
            toast.success(`${selectedIds.length} request${selectedIds.length > 1 ? 's' : ''} approved`);
            setSelectedIds([]);
            await loadData();
        } catch (error) {
            toast.error('Failed to approve some requests');
        } finally {
            setBulkActionLoading(false);
        }
    };

    const handleBulkReject = async () => {
        setBulkActionLoading(true);
        try {
            await Promise.all(selectedIds.map(id => leaveApi.rejectRequest(id)));
            toast.success(`${selectedIds.length} request${selectedIds.length > 1 ? 's' : ''} rejected`);
            setSelectedIds([]);
            await loadData();
        } catch (error) {
            toast.error('Failed to reject some requests');
        } finally {
            setBulkActionLoading(false);
        }
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

        // Date range filter
        let matchesDateRange = true;
        if (dateRangeFilter !== 'all') {
            const startDate = new Date(req.startDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (dateRangeFilter === 'week') {
                const weekFromNow = new Date(today);
                weekFromNow.setDate(today.getDate() + 7);
                matchesDateRange = startDate >= today && startDate <= weekFromNow;
            } else if (dateRangeFilter === 'month') {
                const monthFromNow = new Date(today);
                monthFromNow.setMonth(today.getMonth() + 1);
                matchesDateRange = startDate >= today && startDate <= monthFromNow;
            }
        }

        return matchesSearch && matchesType && matchesDateRange;
    });

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
                        <ClipboardCheck className="w-7 h-7 text-primary-600" />
                        Leave Approvals
                    </h1>
                    <p className="text-warm-600 mt-1">
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
                            <div className="text-2xl font-bold text-warm-900">{stats.pending}</div>
                            <div className="text-sm text-warm-500">Pending Requests</div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-4">
                        <div className="p-3 bg-emerald-100 rounded-lg">
                            <CheckCircle className="w-6 h-6 text-emerald-600" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-warm-900">{stats.approvedToday}</div>
                            <div className="text-sm text-warm-500">Approved Today</div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-4">
                        <div className="p-3 bg-red-100 rounded-lg">
                            <XCircle className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-warm-900">{stats.rejectedToday}</div>
                            <div className="text-sm text-warm-500">Rejected Today</div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-warm-400" />
                    <input
                        type="text"
                        placeholder="Search by employee name or code..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-warm-400" />
                    <select
                        value={leaveTypeFilter}
                        onChange={(e) => setLeaveTypeFilter(e.target.value)}
                        className="border border-warm-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                        <option value="all">All Leave Types</option>
                        {leaveTypes.map(type => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>
                    <select
                        value={dateRangeFilter}
                        onChange={(e) => setDateRangeFilter(e.target.value as any)}
                        className="border border-warm-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                        <option value="all">All Dates</option>
                        <option value="week">Next 7 Days</option>
                        <option value="month">Next 30 Days</option>
                    </select>
                </div>
            </div>

            {/* Select All */}
            {filteredRequests.length > 0 && (
                <div className="flex items-center gap-2 px-2">
                    <input
                        type="checkbox"
                        checked={selectedIds.length === filteredRequests.length && filteredRequests.length > 0}
                        onChange={handleSelectAll}
                        className="w-4 h-4 rounded border-warm-300 text-primary-600 focus:ring-2 focus:ring-primary-500 cursor-pointer"
                    />
                    <label className="text-sm text-warm-700 cursor-pointer" onClick={handleSelectAll}>
                        Select all {filteredRequests.length} request{filteredRequests.length > 1 ? 's' : ''}
                    </label>
                </div>
            )}

            {/* Approval Cards */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="text-center">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent mx-auto" />
                        <p className="mt-4 text-warm-600">Loading pending approvals...</p>
                    </div>
                </div>
            ) : filteredRequests.length === 0 ? (
                <Card>
                    <CardContent className="py-16 text-center">
                        <Users className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-warm-900 mb-2">
                            {requests.length === 0 ? 'No Pending Requests' : 'No Matching Requests'}
                        </h3>
                        <p className="text-warm-600">
                            {requests.length === 0
                                ? "You don't have any leave requests waiting for approval."
                                : 'Try adjusting your search or filter criteria.'}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredRequests.map((request) => (
                            <ApprovalCard
                                key={request.id}
                                request={request}
                                onApprove={handleApprove}
                                onReject={handleReject}
                                isSelected={selectedIds.includes(request.id)}
                                onToggleSelect={handleToggleSelect}
                                showUrgency={true}
                            />
                        ))}
                    </div>

                    {/* Bulk Approval Bar */}
                    <BulkApprovalBar
                        selectedCount={selectedIds.length}
                        onApproveSelected={handleBulkApprove}
                        onRejectSelected={handleBulkReject}
                        onClearSelection={() => setSelectedIds([])}
                        loading={bulkActionLoading}
                    />
                </>
            )}
        </div>
    );
}
