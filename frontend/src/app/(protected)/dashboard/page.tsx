'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, getStatusBadgeVariant } from '@/components/ui';
import { Clock, Calendar, Users, ClipboardCheck, TrendingUp, LogIn, LogOut, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, attendanceApi, adminApi } from '@/lib/api';
import { formatMinutesToHoursMinutes, formatTime, formatDateForApi, getStartOfMonth } from '@/lib/date-utils';
import { AttendanceRecord, AttendanceSummary, DashboardStats, TodayAttendance } from '@/types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

interface AnalyticsData {
  headcountByDepartment: { department: string; count: number }[];
  employmentTypeDistribution: { type: string; count: number }[];
  monthlyJoins: { month: string; count: number }[];
  leaveUtilization: { type: string; days: number }[];
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

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
            <p className="text-sm font-medium text-warm-500">{title}</p>
            <p className="text-2xl font-bold text-warm-900 mt-1">{value}</p>
            {description && (
              <p className="text-xs text-warm-400 mt-1">{description}</p>
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
  const router = useRouter();
  const { user, isManager, isAdmin } = useAuth();
  const [todayAttendance, setTodayAttendance] = useState<TodayAttendance | null>(null);
  const [monthlySummary, setMonthlySummary] = useState<AttendanceSummary | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
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
        const todayData = await attendanceApi.getTodayStatus();
        const data = todayData.data;
        // Map backend response to frontend TodayAttendance format
        // Backend returns: { status, clockedIn, clockInTime, clockOutTime, workedMinutes, ... }
        // Frontend expects: { record, canClockIn, canClockOut }
        const isClockedIn = data.clockedIn || false;
        const hasClockInTime = !!data.clockInTime;
        const hasClockOutTime = !!data.clockOutTime;
        setTodayAttendance({
          record: data.record || (hasClockInTime ? {
            status: data.status,
            clockInTime: data.clockInTime,
            clockOutTime: data.clockOutTime,
            workedMinutes: data.workedMinutes || 0,
            otMinutesCalculated: data.otMinutesCalculated || 0,
            otMinutesApproved: data.otMinutesApproved,
            clockInLatitude: data.clockInLatitude,
            clockInLongitude: data.clockInLongitude,
            clockOutLatitude: data.clockOutLatitude,
            clockOutLongitude: data.clockOutLongitude,
          } as AttendanceRecord : undefined),
          canClockIn: data.canClockIn ?? (!hasClockInTime || (!isClockedIn && hasClockOutTime)),
          canClockOut: data.canClockOut ?? isClockedIn,
        });
      } catch {
        // If endpoint doesn't exist, try getting attendance for today
        const response = await attendanceApi.getMyAttendance(today, today);
        const records = response.data;
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
        const summary = await attendanceApi.getSummary({ from: startOfMonth, to: today });
        setMonthlySummary(summary.data);
      } catch {
        // Calculate from records if summary endpoint doesn't exist
        const response = await attendanceApi.getMyAttendance(startOfMonth, today);
        const records: AttendanceRecord[] = response.data;
        const summary: AttendanceSummary = {
          presentDays: records.filter((r: AttendanceRecord) => r.status === 'PRESENT').length,
          absentDays: records.filter((r: AttendanceRecord) => r.status === 'ABSENT').length,
          leaveDays: records.filter((r: AttendanceRecord) => r.status === 'LEAVE').length,
          wfhDays: records.filter((r: AttendanceRecord) => r.status === 'WFH').length,
          totalWorkedMinutes: records.reduce((sum: number, r: AttendanceRecord) => sum + r.workedMinutes, 0),
          totalOtMinutes: records.reduce((sum: number, r: AttendanceRecord) => sum + r.otMinutesCalculated, 0),
          totalApprovedOtMinutes: records.reduce((sum: number, r: AttendanceRecord) => sum + (r.otMinutesApproved || 0), 0),
        };
        setMonthlySummary(summary);
      }

      // Load dashboard stats and analytics for managers/admins
      if (isManager || isAdmin) {
        try {
          const [stats, analyticsRes] = await Promise.all([
            adminApi.getDashboard(),
            adminApi.getAnalytics(),
          ]);
          setDashboardStats(stats.data);
          setAnalytics(analyticsRes.data);
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

  const getLocation = (): Promise<{ latitude: number; longitude: number }> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            reject(new Error('Location permission denied. Please allow location access to record attendance.'));
          } else if (err.code === err.TIMEOUT) {
            reject(new Error('Location request timed out. Please try again in an open area.'));
          } else {
            reject(new Error('Unable to retrieve your location. Please check your device GPS settings.'));
          }
        },
        { timeout: 10000, maximumAge: 0 },
      );
    });

  const handleClockIn = async () => {
    try {
      setClockingIn(true);
      const { latitude, longitude } = await getLocation();
      await attendanceApi.clockIn(latitude, longitude);
      toast.success('Clocked in successfully');
      await loadDashboardData();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to clock in. Please try again.';
      toast.error(message);
    } finally {
      setClockingIn(false);
    }
  };

  const handleClockOut = async () => {
    try {
      setClockingOut(true);
      const { latitude, longitude } = await getLocation();
      await attendanceApi.clockOut(latitude, longitude);
      toast.success('Clocked out successfully');
      await loadDashboardData();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Failed to clock out. Please try again.';
      toast.error(message);
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
        <h1 className="text-xl sm:text-2xl font-bold text-warm-900">
          {getGreeting()}, {user?.employee?.firstName || user?.email?.split('@')[0]}!
        </h1>
        <p className="text-warm-500">
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
                <p className="text-sm text-warm-500">Status</p>
                <Badge variant={getStatusBadgeVariant(todayAttendance?.record?.status || 'ABSENT')}>
                  {todayAttendance?.record?.status || 'Not Clocked In'}
                </Badge>
              </div>

              {/* Clock In Time */}
              {todayAttendance?.record?.clockInTime && (
                <div>
                  <p className="text-sm text-warm-500">Clock In</p>
                  <p className="font-medium">{formatTime(todayAttendance.record.clockInTime)}</p>
                  {todayAttendance.record.clockInLatitude != null && todayAttendance.record.clockInLongitude != null && (
                    <a
                      href={`https://www.google.com/maps?q=${todayAttendance.record.clockInLatitude},${todayAttendance.record.clockInLongitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-600 hover:underline flex items-center gap-0.5 mt-0.5"
                    >
                      <MapPin className="h-3 w-3" />
                      Location
                    </a>
                  )}
                </div>
              )}

              {/* Clock Out Time */}
              {todayAttendance?.record?.clockOutTime && (
                <div>
                  <p className="text-sm text-warm-500">Clock Out</p>
                  <p className="font-medium">{formatTime(todayAttendance.record.clockOutTime)}</p>
                  {todayAttendance.record.clockOutLatitude != null && todayAttendance.record.clockOutLongitude != null && (
                    <a
                      href={`https://www.google.com/maps?q=${todayAttendance.record.clockOutLatitude},${todayAttendance.record.clockOutLongitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-600 hover:underline flex items-center gap-0.5 mt-0.5"
                    >
                      <MapPin className="h-3 w-3" />
                      Location
                    </a>
                  )}
                </div>
              )}

              {/* Worked Hours */}
              {todayAttendance?.record?.workedMinutes ? (
                <div>
                  <p className="text-sm text-warm-500">Worked</p>
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
                <p className="text-sm text-warm-500">You have completed your shift for today.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Summary Stats */}
      <div>
        <h2 className="text-lg font-semibold text-warm-900 mb-4">This Month</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
            icon={<Clock className="h-6 w-6 text-emerald-600" />}
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
          <h2 className="text-lg font-semibold text-warm-900 mb-4">Team Overview</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              title="Total Employees"
              value={dashboardStats.totalEmployees}
              icon={<Users className="h-6 w-6 text-primary-600" />}
              description={`${dashboardStats.activeEmployees} active`}
            />
            <StatCard
              title="Present Today"
              value={dashboardStats.presentToday}
              icon={<Calendar className="h-6 w-6 text-emerald-600" />}
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
                    <Button variant="secondary" onClick={() => router.push('/approvals/leave')}>
                      Review {dashboardStats.pendingLeaveRequests} Leave Request{dashboardStats.pendingLeaveRequests > 1 ? 's' : ''}
                    </Button>
                  )}
                  {dashboardStats.pendingOtApprovals > 0 && (
                    <Button variant="secondary" onClick={() => router.push('/approvals/ot')}>
                      Review {dashboardStats.pendingOtApprovals} OT Approval{dashboardStats.pendingOtApprovals > 1 ? 's' : ''}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Analytics Charts (Managers/Admins) */}
      {(isManager || isAdmin) && analytics && (
        <div>
          <h2 className="text-lg font-semibold text-warm-900 mb-4">Analytics</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Headcount by Department */}
            {analytics.headcountByDepartment.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-warm-700">Headcount by Department</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.headcountByDepartment} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="department" width={100} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Employment Type Distribution */}
            {analytics.employmentTypeDistribution.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-warm-700">Employment Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={analytics.employmentTypeDistribution}
                          dataKey="count"
                          nameKey="type"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          label={({ name, percent }: { name?: string; percent?: number }) => `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {analytics.employmentTypeDistribution.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Monthly New Hires */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-warm-700">New Hires (Last 6 Months)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.monthlyJoins}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Leave Utilization */}
            {analytics.leaveUtilization.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-warm-700">Leave Utilization (This Year)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.leaveUtilization} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="type" width={100} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="days" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
