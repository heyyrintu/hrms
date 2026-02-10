'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { OTApprovalCard } from '@/components/approvals/OTApprovalCard';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { attendanceApi } from '@/lib/api';
import {
  RefreshCw,
  Clock,
  Search,
  Filter,
  CheckCircle,
  TrendingUp,
  Users,
} from 'lucide-react';
import { cn, formatMinutesToHours } from '@/lib/utils';
import { AttendanceRecord } from '@/types';

export default function OtApprovalsPage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('week');
  const [stats, setStats] = useState({
    pending: 0,
    approvedToday: 0,
    totalOtMinutes: 0,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await attendanceApi.getPendingOtApprovals();
      const pendingRecords = res.data || [];
      setRecords(pendingRecords);

      // Calculate stats
      const totalOt = pendingRecords.reduce(
        (sum: number, r: AttendanceRecord) => sum + r.otMinutesCalculated,
        0
      );

      setStats({
        pending: pendingRecords.length,
        approvedToday: 0, // Would need additional API to get this
        totalOtMinutes: totalOt,
      });
    } catch (error) {
      console.error('Failed to load OT approvals:', error);
      toast.error('Failed to load OT approvals');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string, minutes: number, remarks?: string) => {
    try {
      await attendanceApi.approveOt(id, minutes, remarks);
      toast.success(`OT approved: ${formatMinutesToHours(minutes)}`);
      await loadData();
    } catch (error: any) {
      const message = error.response?.data?.message || 'Failed to approve OT';
      toast.error(message);
    }
  };

  // Filter records by search and date
  const filteredRecords = records.filter(record => {
    if (!record.employee) return false;

    // Search filter
    const matchesSearch =
      record.employee.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.employee.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.employee.employeeCode.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    // Date filter
    const recordDate = new Date(record.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (dateFilter) {
      case 'today':
        return recordDate.toDateString() === today.toDateString();
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        return recordDate >= weekAgo;
      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        return recordDate >= monthAgo;
      default:
        return true;
    }
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-7 h-7 text-orange-600" />
            OT Approvals
          </h1>
          <p className="text-gray-600 mt-1">
            Review and approve overtime hours for your team
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
            <div className="p-3 bg-orange-100 rounded-lg">
              <Clock className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{stats.pending}</div>
              <div className="text-sm text-gray-500">Pending Approvals</div>
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
            <div className="p-3 bg-blue-100 rounded-lg">
              <TrendingUp className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {formatMinutesToHours(stats.totalOtMinutes)}
              </div>
              <div className="text-sm text-gray-500">Total OT Pending</div>
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
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>
      </div>

      {/* Approval Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-orange-600 border-t-transparent mx-auto" />
            <p className="mt-4 text-gray-600">Loading pending approvals...</p>
          </div>
        </div>
      ) : filteredRecords.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Clock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {records.length === 0 ? 'No Pending OT Approvals' : 'No Matching Records'}
            </h3>
            <p className="text-gray-600">
              {records.length === 0
                ? "You don't have any overtime waiting for approval."
                : 'Try adjusting your search or filter criteria.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRecords.map((record) => (
            <OTApprovalCard
              key={record.id}
              record={record}
              onApprove={handleApprove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
