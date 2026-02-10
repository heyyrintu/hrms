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
// HOLIDAY TYPES
// ============================================

export enum HolidayType {
  NATIONAL = 'NATIONAL',
  REGIONAL = 'REGIONAL',
  COMPANY = 'COMPANY',
  OPTIONAL = 'OPTIONAL',
}

export interface Holiday {
  id: string;
  tenantId: string;
  name: string;
  date: string;
  type: HolidayType;
  region?: string;
  isOptional: boolean;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// SHIFT TYPES
// ============================================

export interface Shift {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  standardWorkMinutes: number;
  graceMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftAssignment {
  id: string;
  tenantId: string;
  employeeId: string;
  shiftId: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  employee?: { firstName: string; lastName: string; employeeCode: string };
  shift?: { name: string; code: string; startTime?: string; endTime?: string };
  createdAt: string;
  updatedAt: string;
}

// ============================================
// DOCUMENT TYPES
// ============================================

export enum DocumentCategory {
  ID_PROOF = 'ID_PROOF',
  ADDRESS_PROOF = 'ADDRESS_PROOF',
  EDUCATION = 'EDUCATION',
  EMPLOYMENT = 'EMPLOYMENT',
  CONTRACT = 'CONTRACT',
  CERTIFICATE = 'CERTIFICATE',
  TAX = 'TAX',
  OTHER = 'OTHER',
}

export interface EmployeeDocument {
  id: string;
  tenantId: string;
  employeeId: string;
  uploadId: string;
  name: string;
  category: DocumentCategory;
  documentDate?: string;
  expiryDate?: string;
  isVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
  upload: {
    fileName: string;
    mimeType: string;
    size: number;
    key: string;
  };
  employee?: { firstName: string; lastName: string; employeeCode: string };
  createdAt: string;
  updatedAt: string;
}

// ============================================
// CHANGE REQUEST TYPES
// ============================================

export enum ChangeRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface EmployeeChangeRequest {
  id: string;
  tenantId: string;
  employeeId: string;
  fieldName: string;
  oldValue?: string;
  newValue: string;
  reason?: string;
  status: ChangeRequestStatus;
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: string;
  employee?: { firstName: string; lastName: string; employeeCode: string };
  reviewer?: { firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
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

// ============================================
// NOTIFICATION TYPES
// ============================================

export enum NotificationType {
  LEAVE_APPROVED = 'LEAVE_APPROVED',
  LEAVE_REJECTED = 'LEAVE_REJECTED',
  OT_APPROVED = 'OT_APPROVED',
  OT_REJECTED = 'OT_REJECTED',
  CHANGE_REQUEST_APPROVED = 'CHANGE_REQUEST_APPROVED',
  CHANGE_REQUEST_REJECTED = 'CHANGE_REQUEST_REJECTED',
  DOCUMENT_VERIFIED = 'DOCUMENT_VERIFIED',
  SHIFT_ASSIGNED = 'SHIFT_ASSIGNED',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  GENERAL = 'GENERAL',
}

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ============================================
// ANNOUNCEMENT TYPES
// ============================================

export enum AnnouncementPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export interface Announcement {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  isPublished: boolean;
  publishedAt?: string;
  expiresAt?: string;
  authorId: string;
  author?: { firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

// ============================================
// REPORT TYPES
// ============================================

export enum ReportFormat {
  CSV = 'csv',
  XLSX = 'xlsx',
}

export enum ReportType {
  ATTENDANCE = 'attendance',
  LEAVE = 'leave',
  EMPLOYEE = 'employee',
}

export interface AttendanceReportParams {
  from: string;
  to: string;
  departmentId?: string;
  employeeId?: string;
  format?: ReportFormat;
}

export interface LeaveReportParams {
  year?: string;
  departmentId?: string;
  employeeId?: string;
  format?: ReportFormat;
}

export interface EmployeeReportParams {
  departmentId?: string;
  status?: string;
  employmentType?: string;
  format?: ReportFormat;
}

// ============================================
// PAYROLL TYPES
// ============================================

export enum PayrollRunStatus {
  DRAFT = 'DRAFT',
  PROCESSING = 'PROCESSING',
  COMPUTED = 'COMPUTED',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
}

export interface SalaryComponent {
  name: string;
  type: 'earning' | 'deduction';
  calcType: 'fixed' | 'percentage';
  value: number;
}

export interface SalaryStructure {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  components: SalaryComponent[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { employeeSalaries: number };
}

export interface EmployeeSalary {
  id: string;
  tenantId: string;
  employeeId: string;
  salaryStructureId: string;
  basePay: number;
  effectiveFrom: string;
  effectiveTo?: string;
  isActive: boolean;
  salaryStructure?: { id: string; name: string; components?: SalaryComponent[] };
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRun {
  id: string;
  tenantId: string;
  month: number;
  year: number;
  status: PayrollRunStatus;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  processedCount: number;
  remarks?: string;
  processedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { payslips: number };
  payslips?: Payslip[];
}

export interface PayslipLineItem {
  name: string;
  amount: number;
}

export interface Payslip {
  id: string;
  tenantId: string;
  payrollRunId: string;
  employeeId: string;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  lopDays: number;
  otHours: number;
  basePay: number;
  earnings: PayslipLineItem[];
  deductions: PayslipLineItem[];
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  otPay: number;
  employee?: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    email?: string;
    designation?: string;
    department?: { name: string };
    joinDate?: string;
  };
  payrollRun?: { month: number; year: number; status: PayrollRunStatus };
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// Expense Management
// ==========================================

export type ExpenseClaimStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED';

export interface ExpenseCategory {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description?: string;
  maxAmount?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseClaim {
  id: string;
  tenantId: string;
  employeeId: string;
  categoryId: string;
  amount: number;
  description: string;
  expenseDate: string;
  receiptId?: string;
  status: ExpenseClaimStatus;
  approverId?: string;
  approverNote?: string;
  approvedAt?: string;
  reimbursedAt?: string;
  createdAt: string;
  updatedAt: string;
  category?: { id: string; name: string; code: string };
  employee?: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation?: string;
    department?: { name: string };
  };
}

// ==========================================
// Onboarding / Offboarding
// ==========================================

export type OnboardingType = 'ONBOARDING' | 'OFFBOARDING';
export type OnboardingProcessStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type OnboardingTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
export type OnboardingTaskCategory = 'IT_SETUP' | 'HR_PAPERWORK' | 'TRAINING' | 'COMPLIANCE' | 'FACILITIES' | 'GENERAL';

export interface TaskDefinition {
  title: string;
  description?: string;
  category: string;
  defaultAssigneeRole?: string;
  daysAfterStart?: number;
  sortOrder: number;
}

export interface OnboardingTemplate {
  id: string;
  tenantId: string;
  name: string;
  type: OnboardingType;
  description?: string;
  tasks: TaskDefinition[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { processes: number };
}

export interface OnboardingProcess {
  id: string;
  tenantId: string;
  employeeId: string;
  templateId: string;
  type: OnboardingType;
  status: OnboardingProcessStatus;
  startDate?: string;
  targetDate?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  employee?: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation?: string;
    department?: { name: string };
  };
  template?: { id: string; name: string; type: OnboardingType };
  tasks?: OnboardingTask[];
  _count?: { tasks: number };
  completedTaskCount?: number;
}

export interface OnboardingTask {
  id: string;
  tenantId: string;
  processId: string;
  title: string;
  description?: string;
  category: OnboardingTaskCategory;
  assigneeId?: string;
  status: OnboardingTaskStatus;
  dueDate?: string;
  completedAt?: string;
  sortOrder: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  assignee?: { id: string; firstName: string; lastName: string; employeeCode: string };
  process?: {
    id: string;
    type: OnboardingType;
    status: OnboardingProcessStatus;
    employee?: { firstName: string; lastName: string };
  };
}

// ============================================
// AUDIT
// ============================================

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN';

export interface AuditLog {
  id: string;
  tenantId: string;
  userId?: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

// ============================================
// PERFORMANCE MANAGEMENT
// ============================================

export type ReviewCycleStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';
export type PerformanceReviewStatus = 'PENDING' | 'SELF_REVIEW' | 'MANAGER_REVIEW' | 'COMPLETED';
export type GoalStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface ReviewCycle {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: ReviewCycleStatus;
  createdAt: string;
  updatedAt: string;
  _count?: { reviews: number };
}

export interface PerformanceReview {
  id: string;
  tenantId: string;
  cycleId: string;
  employeeId: string;
  reviewerId: string;
  status: PerformanceReviewStatus;
  selfRating?: number;
  selfComments?: string;
  managerRating?: number;
  managerComments?: string;
  overallRating?: number;
  selfSubmittedAt?: string;
  managerSubmittedAt?: string;
  createdAt: string;
  updatedAt: string;
  cycle?: { id: string; name: string; startDate: string; endDate: string };
  employee?: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation?: string;
    department?: { name: string };
  };
  reviewer?: { id: string; firstName: string; lastName: string };
  goals?: Goal[];
  _count?: { goals: number };
}

export interface Goal {
  id: string;
  tenantId: string;
  reviewId: string;
  employeeId: string;
  title: string;
  description?: string;
  targetDate: string;
  status: GoalStatus;
  progress: number;
  weight: number;
  createdAt: string;
  updatedAt: string;
  review?: {
    id: string;
    status: PerformanceReviewStatus;
    cycle?: { id: string; name: string };
  };
}
