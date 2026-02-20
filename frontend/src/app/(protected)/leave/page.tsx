'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { leaveApi } from '@/lib/api';
import { formatDate, getStatusColor, cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Plus,
  Clock,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  X,
  FileText,
  Filter,
  RefreshCw,
} from 'lucide-react';

interface LeaveBalance {
  id: string;
  leaveType: { id: string; name: string; code: string };
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  carriedOver: number;
}

interface LeaveRequest {
  id: string;
  leaveType: { name: string; code: string };
  startDate: string;
  endDate: string;
  totalDays: number;
  isHalfDay?: boolean;
  halfDayPeriod?: 'FIRST_HALF' | 'SECOND_HALF';
  status: string;
  reason?: string;
  approver?: { firstName: string; lastName: string };
  approverNote?: string;
  createdAt: string;
}

export default function LeavePage() {
  const router = useRouter();
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [balancesRes, requestsRes] = await Promise.all([
        leaveApi.getMyBalances(),
        leaveApi.getMyRequests(),
      ]);
      setBalances(balancesRes.data);
      setRequests(requestsRes.data.data || []);
    } catch (err: unknown) {
      console.error('Failed to load leave data:', err);
      const axiosError = err as { response?: { data?: { message?: string } } };
      setError(axiosError.response?.data?.message || 'Failed to load leave data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelClick = (id: string) => {
    setSelectedRequestId(id);
    setCancelModalOpen(true);
  };

  const handleCancelConfirm = async () => {
    if (!selectedRequestId) return;

    setCancelling(true);
    try {
      await leaveApi.cancelRequest(selectedRequestId);
      setCancelModalOpen(false);
      setSelectedRequestId(null);
      await loadData();
    } catch (err) {
      console.error('Failed to cancel request:', err);
    } finally {
      setCancelling(false);
    }
  };

  const filteredRequests = requests.filter(req =>
    statusFilter === 'all' || req.status === statusFilter
  );

  const getLeaveTypeColor = (code: string): string => {
    const colors: Record<string, string> = {
      'CL': 'from-blue-500 to-blue-600',
      'SL': 'from-red-500 to-red-600',
      'PL': 'from-emerald-500 to-emerald-600',
      'LOP': 'from-warm-500 to-warm-600',
      'ML': 'from-pink-500 to-pink-600',
      'PFL': 'from-purple-500 to-purple-600',
    };
    return colors[code] || 'from-indigo-500 to-indigo-600';
  };

  const getProgressPercentage = (used: number, total: number): number => {
    if (total === 0) return 0;
    return Math.min((used / total) * 100, 100);
  };

  if (loading) {
    return (
      <>
        <div className="flex h-full items-center justify-center py-20">
          <div className="text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent mx-auto" />
            <p className="mt-4 text-warm-600">Loading leave information...</p>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="flex h-full items-center justify-center py-20">
          <Card className="max-w-md text-center">
            <CardContent className="py-8">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <X className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-warm-900 mb-2">Unable to Load Leave Data</h3>
              <p className="text-warm-600 mb-4">{error}</p>
              <Button onClick={loadData}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Leave Management</h1>
            <p className="text-warm-600 mt-1">Track your leave balances and requests</p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={loadData}
              disabled={loading}
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={() => router.push('/leave/request')}>
              <Plus className="w-4 h-4 mr-2" />
              Request Leave
            </Button>
          </div>
        </div>

        {/* Leave Balances */}
        <div>
          <h2 className="text-lg font-semibold text-warm-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary-600" />
            Leave Balances
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {balances.map((balance) => {
              const total = balance.totalDays + balance.carriedOver;
              const used = balance.usedDays;
              const pending = balance.pendingDays;
              const available = total - used - pending;
              const usedPercent = getProgressPercentage(used, total);
              const pendingPercent = getProgressPercentage(pending, total);

              return (
                <Card key={balance.id} className="overflow-hidden">
                  <div className={cn(
                    'h-2 bg-gradient-to-r',
                    getLeaveTypeColor(balance.leaveType.code)
                  )} />
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-warm-900">{balance.leaveType.name}</h3>
                        <span className={cn(
                          'inline-block px-2 py-0.5 text-xs font-medium rounded mt-1 bg-gradient-to-r text-white',
                          getLeaveTypeColor(balance.leaveType.code)
                        )}>
                          {balance.leaveType.code}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-warm-900">{available}</div>
                        <div className="text-xs text-warm-500">available</div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-2 bg-warm-100 rounded-full overflow-hidden mb-3">
                      <div className="h-full flex">
                        <div
                          className="bg-warm-400 transition-all"
                          style={{ width: `${usedPercent}%` }}
                        />
                        <div
                          className="bg-yellow-400 transition-all"
                          style={{ width: `${pendingPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 bg-warm-50 rounded">
                        <div className="text-warm-500">Total</div>
                        <div className="font-semibold text-warm-900">{total}</div>
                      </div>
                      <div className="p-2 bg-warm-50 rounded">
                        <div className="text-warm-500">Used</div>
                        <div className="font-semibold text-warm-600">{used}</div>
                      </div>
                      <div className="p-2 bg-yellow-50 rounded">
                        <div className="text-yellow-600">Pending</div>
                        <div className="font-semibold text-yellow-700">{pending}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {balances.length === 0 && (
              <Card className="col-span-full">
                <CardContent className="py-12 text-center text-warm-500">
                  <Calendar className="w-12 h-12 mx-auto mb-4 text-warm-300" />
                  <p>No leave balances found for this year.</p>
                  <p className="text-sm mt-1">Contact HR to set up your leave allocation.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Leave Requests */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-warm-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary-600" />
              My Requests
            </h2>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-warm-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-sm border border-warm-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="all">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          <Card padding="none">
            <div className="divide-y divide-warm-100">
              {filteredRequests.length === 0 ? (
                <div className="py-12 text-center text-warm-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 text-warm-300" />
                  <p>No leave requests found.</p>
                  <Button
                    variant="ghost"
                    className="mt-4"
                    onClick={() => router.push('/leave/request')}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Submit your first request
                  </Button>
                </div>
              ) : (
                filteredRequests.map((request) => (
                  <div key={request.id} className="p-4 hover:bg-warm-50 transition-colors">
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedRequest(
                        expandedRequest === request.id ? null : request.id
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold bg-gradient-to-r',
                          getLeaveTypeColor(request.leaveType.code)
                        )}>
                          {request.leaveType.code}
                        </div>
                        <div>
                          <div className="font-medium text-warm-900 flex items-center gap-2">
                            {request.leaveType.name}
                            {request.isHalfDay && (
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                Half Day {request.halfDayPeriod === 'FIRST_HALF' ? '(AM)' : '(PM)'}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-warm-500">
                            {formatDate(request.startDate)}{!request.isHalfDay && <> — {formatDate(request.endDate)}</>}
                            <span className="ml-2 text-warm-400">
                              ({request.totalDays} day{request.totalDays !== 1 ? 's' : ''})
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={cn('badge', getStatusColor(request.status))}>
                          {request.status}
                        </span>
                        {expandedRequest === request.id ? (
                          <ChevronUp className="w-5 h-5 text-warm-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-warm-400" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {expandedRequest === request.id && (
                      <div className="mt-4 pt-4 border-t border-warm-100">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                          {request.reason && (
                            <div>
                              <span className="text-warm-500">Reason:</span>
                              <p className="text-warm-900 mt-1">{request.reason}</p>
                            </div>
                          )}
                          <div>
                            <span className="text-warm-500">Submitted on:</span>
                            <p className="text-warm-900 mt-1">{formatDate(request.createdAt)}</p>
                          </div>
                          {request.approver && (
                            <div>
                              <span className="text-warm-500">Approver:</span>
                              <p className="text-warm-900 mt-1">
                                {request.approver.firstName} {request.approver.lastName}
                              </p>
                            </div>
                          )}
                          {request.approverNote && (
                            <div>
                              <span className="text-warm-500">Approver Note:</span>
                              <p className="text-warm-900 mt-1">{request.approverNote}</p>
                            </div>
                          )}
                        </div>

                        {request.status === 'PENDING' && (
                          <div className="mt-4 pt-4 border-t border-warm-100 flex justify-end">
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelClick(request.id);
                              }}
                            >
                              <X className="w-4 h-4 mr-1" />
                              Cancel Request
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      <Modal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Cancel Leave Request"
        size="sm"
      >
        <p className="text-warm-600">
          Are you sure you want to cancel this leave request? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setCancelModalOpen(false)}
            disabled={cancelling}
          >
            Keep Request
          </Button>
          <Button
            variant="danger"
            onClick={handleCancelConfirm}
            loading={cancelling}
          >
            Cancel Request
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
