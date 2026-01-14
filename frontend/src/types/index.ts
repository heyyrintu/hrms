// ============================================
// ENUMS
// ============================================

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  HR_ADMIN = 'HR_ADMIN',
  MANAGER = 'MANAGER',
  EMPLOYEE = 'EMPLOYEE',
}

export enum EmploymentType {
  PERMANENT = 'PERMANENT',
  CONTRACT = 'CONTRACT',
  TEMPORARY = 'TEMPORARY',
  INTERN = 'INTERN',
}

export enum PayType {
  MONTHLY = 'MONTHLY',
  HOURLY = 'HOURLY',
}

export enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  HALF_DAY = 'HALF_DAY',
  LEAVE = 'LEAVE',
  WFH = 'WFH',
  HOLIDAY = 'HOLIDAY',
}

export enum LeaveRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

// ============================================
// COMPANY/TENANT TYPES
// ============================================

export interface Company {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  employeeCount?: number;
  activeEmployeeCount?: number;
  userCount?: number;
  departmentCount?: number;
  leaveTypeCount?: number;
  otRuleCount?: number;
}

export interface CreateCompanyPayload {
  name: string;
  code: string;
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
}

export interface CompanyStats {
  totalCompanies: number;
  activeCompanies: number;
  inactiveCompanies: number;
  totalEmployees: number;
  totalUsers: number;
}

// ============================================
// AUTH TYPES
// ============================================

export interface User {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string;
  employeeId?: string;
  employee?: Employee;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// ============================================
// EMPLOYEE TYPES
// ============================================

export interface Employee {
  id: string;
  tenantId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  employmentType: EmploymentType;
  payType: PayType;
  hourlyRate?: number;
  otMultiplier: number;
  departmentId?: string;
  department?: Department;
  designation?: string;
  managerId?: string;
  manager?: Employee;
  directReports?: Employee[];
  joinDate: string;
  exitDate?: string;
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  departmentId?: string;
  employmentType?: EmploymentType;
  status?: EmployeeStatus;
}

// ============================================
// DEPARTMENT TYPES
// ============================================

export interface Department {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  parentId?: string;
  description?: string;
  isActive: boolean;
  parent?: Department;
  children?: Department[];
  employees?: Employee[];
}

// ============================================
// ATTENDANCE TYPES
// ============================================

export interface AttendanceSession {
  id: string;
  attendanceId: string;
  inTime: string;
  outTime?: string;
  sessionMinutes: number;
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  employeeId: string;
  employee?: Employee;
  date: string;
  clockInTime?: string;
  clockOutTime?: string;
  breakMinutes: number;
  workedMinutes: number;
  standardWorkMinutes: number;
  otMinutesCalculated: number;
  otMinutesApproved?: number;
  status: AttendanceStatus;
  remarks?: string;
  sessions?: AttendanceSession[];
}

export interface AttendanceQueryParams {
  from: string;
  to: string;
  employeeId?: string;
  departmentId?: string;
}

export interface AttendanceSummary {
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  wfhDays: number;
  totalWorkedMinutes: number;
  totalOtMinutes: number;
  totalApprovedOtMinutes: number;
}

export interface TodayAttendance {
  record?: AttendanceRecord;
  canClockIn: boolean;
  canClockOut: boolean;
  activeSession?: AttendanceSession;
}

// ============================================
// OT TYPES
// ============================================

export interface OtRule {
  id: string;
  tenantId: string;
  name: string;
  employmentType?: EmploymentType;
  dailyThresholdMinutes: number;
  weeklyThresholdMinutes?: number;
  roundingIntervalMinutes: number;
  requiresManagerApproval: boolean;
  maxOtPerDayMinutes?: number;
  maxOtPerMonthMinutes?: number;
  isActive: boolean;
}

export interface PendingOtApproval {
  id: string;
  employee: Employee;
  date: string;
  workedMinutes: number;
  standardWorkMinutes: number;
  otMinutesCalculated: number;
  otMinutesApproved?: number;
}

// ============================================
// LEAVE TYPES
// ============================================

export interface LeaveType {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description?: string;
  defaultDays: number;
  carryForward: boolean;
  maxCarryForward?: number;
  isPaid: boolean;
  isActive: boolean;
}

export interface LeaveBalance {
  id: string;
  tenantId: string;
  employeeId: string;
  leaveTypeId: string;
  leaveType: LeaveType;
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  carriedOver: number;
}

export interface LeaveRequest {
  id: string;
  tenantId: string;
  employeeId: string;
  employee?: Employee;
  leaveTypeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason?: string;
  status: LeaveRequestStatus;
  approverId?: string;
  approver?: Employee;
  approverNote?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeaveRequest {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

// ============================================
// DASHBOARD TYPES
// ============================================

export interface DashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  presentToday: number;
  onLeaveToday: number;
  pendingLeaveRequests: number;
  pendingOtApprovals: number;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
  // Also support flat structure for backwards compatibility
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}
