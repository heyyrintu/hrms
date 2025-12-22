'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, getStatusBadgeVariant } from '@/components/ui';
import { Clock, Calendar, Users, ClipboardCheck, TrendingUp, LogIn, LogOut } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { formatMinutesToHoursMinutes, formatTime, formatDateForApi, getStartOfMonth } from '@/lib/date-utils';
import { AttendanceRecord, AttendanceSummary, DashboardStats, TodayAttendance } from '@/types';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
}

function StatCard({ title, value, icon, description }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">{title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
            {description && (
              <p className="text-xs text-gray-400 mt-1">{description}</p>
            )}
          </div>
          <div className="h-12 w-12 rounded-lg bg-primary-50 flex items-center justify-center">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, isManager, isAdmin } = useAuth();
  const [todayAttendance, setTodayAttendance] = useState<TodayAttendance | null>(null);
  const [monthlySummary, setMonthlySummary] = useState<AttendanceSummary | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [clockingIn, setClockingIn] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Load today's attendance
      const today = formatDateForApi(new Date());
      try {
        const todayData = await apiClient.get<{ record?: AttendanceRecord; canClockIn: boolean; canClockOut: boolean }>('/attendance/today');
        setTodayAttendance(todayData);
      } catch {
        // If endpoint doesn't exist, try getting attendance for today
        const records = await apiClient.get<AttendanceRecord[]>('/attendance/me', { from: today, to: today });
        const record = records[0];
        setTodayAttendance({
          record,
          canClockIn: !record?.clockInTime,
          canClockOut: !!record?.clockInTime && !record?.clockOutTime,
        });
      }

      // Load monthly summary
      const startOfMonth = formatDateForApi(getStartOfMonth());
      try {
        const summary = await apiClient.get<AttendanceSummary>('/attendance/summary', { from: startOfMonth, to: today });
        setMonthlySummary(summary);
      } catch {
        // Calculate from records if summary endpoint doesn't exist
        const records = await apiClient.get<AttendanceRecord[]>('/attendance/me', { from: startOfMonth, to: today });
        const summary: AttendanceSummary = {
          presentDays: records.filter(r => r.status === 'PRESENT').length,
          absentDays: records.filter(r => r.status === 'ABSENT').length,
          leaveDays: records.filter(r => r.status === 'LEAVE').length,
          wfhDays: records.filter(r => r.status === 'WFH').length,
          totalWorkedMinutes: records.reduce((sum, r) => sum + r.workedMinutes, 0),
          totalOtMinutes: records.reduce((sum, r) => sum + r.otMinutesCalculated, 0),
          totalApprovedOtMinutes: records.reduce((sum, r) => sum + (r.otMinutesApproved || 0), 0),
        };
        setMonthlySummary(summary);
      }

      // Load dashboard stats for managers/admins
      if (isManager || isAdmin) {
        try {
          const stats = await apiClient.get<DashboardStats>('/admin/dashboard');
          setDashboardStats(stats);
        } catch {
          // Stats endpoint might not exist
        }
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClockIn = async () => {
    try {
      setClockingIn(true);
      await apiClient.post('/attendance/clock-in');
      await loadDashboardData();
    } catch (error) {
      console.error('Clock in failed:', error);
      alert('Failed to clock in. Please try again.');
    } finally {
      setClockingIn(false);
    }
  };

  const handleClockOut = async () => {
    try {
      setClockingOut(true);
      await apiClient.post('/attendance/clock-out');
      await loadDashboardData();
    } catch (error) {
      console.error('Clock out failed:', error);
      alert('Failed to clock out. Please try again.');
    } finally {
      setClockingOut(false);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {getGreeting()}, {user?.employee?.firstName || user?.email?.split('@')[0]}!
        </h1>
        <p className="text-gray-500">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Today's Attendance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary-600" />
            Today&apos;s Attendance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-6">
              {/* Status */}
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <Badge variant={getStatusBadgeVariant(todayAttendance?.record?.status || 'ABSENT')}>
                  {todayAttendance?.record?.status || 'Not Clocked In'}
                </Badge>
              </div>

              {/* Clock In Time */}
              {todayAttendance?.record?.clockInTime && (
                <div>
                  <p className="text-sm text-gray-500">Clock In</p>
                  <p className="font-medium">{formatTime(todayAttendance.record.clockInTime)}</p>
                </div>
              )}

              {/* Clock Out Time */}
              {todayAttendance?.record?.clockOutTime && (
                <div>
                  <p className="text-sm text-gray-500">Clock Out</p>
                  <p className="font-medium">{formatTime(todayAttendance.record.clockOutTime)}</p>
                </div>
              )}

              {/* Worked Hours */}
              {todayAttendance?.record?.workedMinutes ? (
                <div>
                  <p className="text-sm text-gray-500">Worked</p>
                  <p className="font-medium">{formatMinutesToHoursMinutes(todayAttendance.record.workedMinutes)}</p>
                </div>
              ) : null}
            </div>

            {/* Clock In/Out Buttons */}
            <div className="flex gap-3">
              {todayAttendance?.canClockIn && (
                <Button onClick={handleClockIn} loading={clockingIn} className="flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  Clock In
                </Button>
              )}
              {todayAttendance?.canClockOut && (
                <Button onClick={handleClockOut} loading={clockingOut} variant="secondary" className="flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  Clock Out
                </Button>
              )}
              {!todayAttendance?.canClockIn && !todayAttendance?.canClockOut && todayAttendance?.record?.clockOutTime && (
                <p className="text-sm text-gray-500">You have completed your shift for today.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Summary Stats */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">This Month</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Present Days"
            value={monthlySummary?.presentDays || 0}
            icon={<Calendar className="h-6 w-6 text-primary-600" />}
          />
          <StatCard
            title="Leave Days"
            value={monthlySummary?.leaveDays || 0}
            icon={<Calendar className="h-6 w-6 text-yellow-600" />}
          />
          <StatCard
            title="Total Hours Worked"
            value={formatMinutesToHoursMinutes(monthlySummary?.totalWorkedMinutes || 0)}
            icon={<Clock className="h-6 w-6 text-green-600" />}
          />
          <StatCard
            title="OT Hours"
            value={formatMinutesToHoursMinutes(monthlySummary?.totalOtMinutes || 0)}
            description={`Approved: ${formatMinutesToHoursMinutes(monthlySummary?.totalApprovedOtMinutes || 0)}`}
            icon={<TrendingUp className="h-6 w-6 text-orange-600" />}
          />
        </div>
      </div>

      {/* Manager/Admin Section */}
      {(isManager || isAdmin) && dashboardStats && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Overview</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Employees"
              value={dashboardStats.totalEmployees}
              icon={<Users className="h-6 w-6 text-primary-600" />}
              description={`${dashboardStats.activeEmployees} active`}
            />
            <StatCard
              title="Present Today"
              value={dashboardStats.presentToday}
              icon={<Calendar className="h-6 w-6 text-green-600" />}
            />
            <StatCard
              title="On Leave Today"
              value={dashboardStats.onLeaveToday}
              icon={<Calendar className="h-6 w-6 text-yellow-600" />}
            />
            <StatCard
              title="Pending Approvals"
              value={dashboardStats.pendingLeaveRequests + dashboardStats.pendingOtApprovals}
              icon={<ClipboardCheck className="h-6 w-6 text-red-600" />}
              description={`${dashboardStats.pendingLeaveRequests} leave, ${dashboardStats.pendingOtApprovals} OT`}
            />
          </div>

          {/* Quick Links */}
          {(dashboardStats.pendingLeaveRequests > 0 || dashboardStats.pendingOtApprovals > 0) && (
            <Card className="mt-4">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-3">
                  {dashboardStats.pendingLeaveRequests > 0 && (
                    <Button variant="secondary" onClick={() => window.location.href = '/approvals/leave'}>
                      Review {dashboardStats.pendingLeaveRequests} Leave Request{dashboardStats.pendingLeaveRequests > 1 ? 's' : ''}
                    </Button>
                  )}
                  {dashboardStats.pendingOtApprovals > 0 && (
                    <Button variant="secondary" onClick={() => window.location.href = '/approvals/ot'}>
                      Review {dashboardStats.pendingOtApprovals} OT Approval{dashboardStats.pendingOtApprovals > 1 ? 's' : ''}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
