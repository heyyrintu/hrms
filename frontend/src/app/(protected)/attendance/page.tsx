'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Card, CardHeader, CardTitle, CardContent,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyState, TableLoadingState,
  Badge, getStatusBadgeVariant, Select, Button
} from '@/components/ui';
import { ChevronLeft, ChevronRight, Download, LogIn, LogOut, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, attendanceApi, employeesApi, departmentsApi } from '@/lib/api';
import { formatDate, formatTime, formatMinutesToHoursMinutes, formatDateForApi, getMonthYear, getDaysInMonth } from '@/lib/date-utils';
import { AttendanceRecord, Employee, Department } from '@/types';

export default function AttendancePage() {
  const { isManager, isAdmin } = useAuth();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState<'personal' | 'team'>('personal');
  
  // Filters for team view
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');

  // Clock in/out state
  const [clockedIn, setClockedIn] = useState(false);
  const [canClockIn, setCanClockIn] = useState(false);
  const [canClockOut, setCanClockOut] = useState(false);
  const [clockingIn, setClockingIn] = useState(false);
  const [clockingOut, setClockingOut] = useState(false);

  useEffect(() => {
    loadAttendance();
    loadTodayStatus();
  }, [currentMonth, viewMode, selectedEmployee, selectedDepartment]);

  useEffect(() => {
    if ((isManager || isAdmin) && viewMode === 'team') {
      loadFilters();
    }
  }, [isManager, isAdmin, viewMode]);

  const loadTodayStatus = async () => {
    try {
      const response = await attendanceApi.getTodayStatus();
      const data = response.data;
      const isClockedIn = data.clockedIn || false;
      const hasClockInTime = !!data.clockInTime;
      const hasClockOutTime = !!data.clockOutTime;
      setClockedIn(isClockedIn);
      setCanClockIn(data.canClockIn ?? (!hasClockInTime || (!isClockedIn && hasClockOutTime)));
      setCanClockOut(data.canClockOut ?? isClockedIn);
    } catch {
      // If no attendance today, user can clock in
      setCanClockIn(true);
      setCanClockOut(false);
      setClockedIn(false);
    }
  };

  const handleClockIn = async () => {
    try {
      setClockingIn(true);
      await attendanceApi.clockIn();
      toast.success('Clocked in successfully!');
      await loadTodayStatus();
      await loadAttendance();
    } catch (error: any) {
      const message = error.response?.data?.message || 'Failed to clock in';
      toast.error(message);
    } finally {
      setClockingIn(false);
    }
  };

  const handleClockOut = async () => {
    try {
      setClockingOut(true);
      await attendanceApi.clockOut();
      toast.success('Clocked out successfully!');
      await loadTodayStatus();
      await loadAttendance();
    } catch (error: any) {
      const message = error.response?.data?.message || 'Failed to clock out';
      toast.error(message);
    } finally {
      setClockingOut(false);
    }
  };

  const loadFilters = async () => {
    try {
      const [empData, deptData] = await Promise.all([
        employeesApi.getAll({ limit: 100 }),
        departmentsApi.getAll(),
      ]);
      setEmployees(empData.data.data || []);
      setDepartments(deptData.data || []);
    } catch (error) {
      console.error('Failed to load filters:', error);
    }
  };

  const loadAttendance = async () => {
    try {
      setLoading(true);
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
      
      const params: Record<string, string> = {
        from: formatDateForApi(startOfMonth),
        to: formatDateForApi(endOfMonth),
      };

      let endpoint = '/attendance/me';
      
      if (viewMode === 'team' && (isManager || isAdmin)) {
        endpoint = '/attendance';
        if (selectedEmployee) params.employeeId = selectedEmployee;
        if (selectedDepartment) params.departmentId = selectedDepartment;
      }

      const response = await api.get<AttendanceRecord[] | { data: AttendanceRecord[] }>(endpoint, { params });
      const data = response.data;
      setRecords(Array.isArray(data) ? data : data.data || []);
    } catch (error) {
      console.error('Failed to load attendance:', error);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const goToCurrentMonth = () => {
    setCurrentMonth(new Date());
  };

  // Generate calendar data
  const generateCalendarData = () => {
    const daysInMonth = getDaysInMonth(currentMonth);
    const calendarDays = [];
    
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
      const dateStr = formatDateForApi(date);
      const record = records.find(r => r.date.split('T')[0] === dateStr);
      
      calendarDays.push({
        date,
        dateStr,
        record,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        isToday: formatDateForApi(new Date()) === dateStr,
      });
    }
    
    return calendarDays;
  };

  const calendarData = generateCalendarData();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
          <p className="text-gray-500">View and track attendance records</p>
        </div>
        
        {/* View Toggle for Managers */}
        {(isManager || isAdmin) && (
          <div className="flex gap-2">
            <Button
              variant={viewMode === 'personal' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('personal')}
            >
              My Attendance
            </Button>
            <Button
              variant={viewMode === 'team' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setViewMode('team')}
            >
              Team Attendance
            </Button>
          </div>
        )}
      </div>

      {/* Clock In/Out Card */}
      {viewMode === 'personal' && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary-600" />
                <div>
                  <p className="font-medium text-gray-900">Today&apos;s Attendance</p>
                  <p className="text-sm text-gray-500">
                    {clockedIn ? 'You are currently clocked in' : canClockIn ? 'You have not clocked in yet' : 'Shift complete for today'}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                {canClockIn && (
                  <Button onClick={handleClockIn} loading={clockingIn} className="flex items-center gap-2">
                    <LogIn className="h-4 w-4" />
                    Clock In
                  </Button>
                )}
                {canClockOut && (
                  <Button onClick={handleClockOut} loading={clockingOut} variant="secondary" className="flex items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    Clock Out
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Month Navigation */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <button
              onClick={goToPreviousMonth}
              className="p-2 rounded-md hover:bg-gray-100"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold">{getMonthYear(currentMonth)}</h2>
              <Button variant="secondary" size="sm" onClick={goToCurrentMonth}>
                Today
              </Button>
            </div>
            
            <button
              onClick={goToNextMonth}
              className="p-2 rounded-md hover:bg-gray-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Team Filters */}
      {viewMode === 'team' && (isManager || isAdmin) && (
        <Card>
          <CardContent className="p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Select
                label="Employee"
                placeholder="All Employees"
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                options={employees.map(emp => ({
                  value: emp.id,
                  label: `${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
                }))}
              />
              <Select
                label="Department"
                placeholder="All Departments"
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                options={departments.map(dept => ({
                  value: dept.id,
                  label: dept.name,
                }))}
              />
              <div className="flex items-end">
                <Button variant="secondary" onClick={loadAttendance}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attendance Table */}
      <Card padding="none">
        <CardHeader className="p-4 border-b">
          <CardTitle>Attendance Records</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {viewMode === 'team' && <TableHead>Employee</TableHead>}
              <TableHead>Status</TableHead>
              <TableHead>Clock In</TableHead>
              <TableHead>Clock Out</TableHead>
              <TableHead>Worked</TableHead>
              <TableHead>OT (Calc)</TableHead>
              <TableHead>OT (Approved)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingState colSpan={viewMode === 'team' ? 8 : 7} />
            ) : calendarData.length === 0 ? (
              <TableEmptyState message="No attendance records found" colSpan={viewMode === 'team' ? 8 : 7} />
            ) : (
              calendarData.map(({ date, dateStr, record, isWeekend, isToday }) => (
                <TableRow key={dateStr} className={isToday ? 'bg-primary-50' : isWeekend ? 'bg-gray-50' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={isToday ? 'font-bold text-primary-600' : ''}>
                        {formatDate(dateStr)}
                      </span>
                      {isToday && (
                        <Badge variant="info">Today</Badge>
                      )}
                    </div>
                  </TableCell>
                  {viewMode === 'team' && (
                    <TableCell>
                      {record?.employee ? `${record.employee.firstName} ${record.employee.lastName}` : '-'}
                    </TableCell>
                  )}
                  <TableCell>
                    {record ? (
                      <Badge variant={getStatusBadgeVariant(record.status)}>
                        {record.status}
                      </Badge>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {record?.clockInTime ? formatTime(record.clockInTime) : '-'}
                  </TableCell>
                  <TableCell>
                    {record?.clockOutTime ? formatTime(record.clockOutTime) : '-'}
                  </TableCell>
                  <TableCell>
                    {record?.workedMinutes ? formatMinutesToHoursMinutes(record.workedMinutes) : '-'}
                  </TableCell>
                  <TableCell>
                    {record?.otMinutesCalculated ? (
                      <span className="text-orange-600">
                        {formatMinutesToHoursMinutes(record.otMinutesCalculated)}
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    {record?.otMinutesApproved !== undefined && record?.otMinutesApproved !== null ? (
                      <span className="text-green-600">
                        {formatMinutesToHoursMinutes(record.otMinutesApproved)}
                      </span>
                    ) : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
