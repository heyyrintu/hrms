'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/Button';
import { leaveApi } from '@/lib/api';
import { formatDate, getStatusColor } from '@/lib/utils';

interface LeaveBalance {
  id: string;
  leaveType: { name: string; code: string };
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
  status: string;
  reason?: string;
}

export default function LeavePage() {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [balancesRes, requestsRes] = await Promise.all([
        leaveApi.getMyBalances(),
        leaveApi.getMyRequests(),
      ]);
      setBalances(balancesRes.data);
      setRequests(requestsRes.data.data || []);
    } catch (error) {
      console.error('Failed to load leave data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await leaveApi.cancelRequest(id);
      await loadData();
    } catch (error) {
      console.error('Failed to cancel request:', error);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
            <p className="text-gray-600">View your leave balances and requests</p>
          </div>
          <Button onClick={() => window.location.href = '/leave/request'}>
            Request Leave
          </Button>
        </div>

        {/* Leave Balances */}
        <div>
          <h2 className="mb-4 text-lg font-semibold">Leave Balances</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {balances.map((balance) => {
              const available = balance.totalDays + balance.carriedOver - balance.usedDays - balance.pendingDays;
              return (
                <div key={balance.id} className="card p-4">
                  <h3 className="font-medium text-gray-900">{balance.leaveType.name}</h3>
                  <p className="text-sm text-gray-500">{balance.leaveType.code}</p>
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Total:</span>
                      <span>{balance.totalDays + balance.carriedOver}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Used:</span>
                      <span>{balance.usedDays}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Pending:</span>
                      <span className="text-yellow-600">{balance.pendingDays}</span>
                    </div>
                    <div className="flex justify-between border-t pt-1 font-medium">
                      <span>Available:</span>
                      <span className="text-green-600">{available}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Leave Requests */}
        <div>
          <h2 className="mb-4 text-lg font-semibold">My Requests</h2>
          <div className="card overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Dates
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Days
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No leave requests found
                    </td>
                  </tr>
                ) : (
                  requests.map((request) => (
                    <tr key={request.id}>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        {request.leaveType.name}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDate(request.startDate)} - {formatDate(request.endDate)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {request.totalDays}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`badge ${getStatusColor(request.status)}`}>
                          {request.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        {request.status === 'PENDING' && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleCancel(request.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
