import axios from 'axios';

import { StatutoryReturnKind, UpdateSettlementPayload } from '@/types/statutory';
import {
  UpdateStatutoryConfigPayload,
  UpsertTaxDeclarationPayload,
} from '@/types/statutory-config';
import { ReviewProofPayload, SubmitProofPayload } from '@/types/proofs';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('hrms_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A rejected login belongs to the form, not the session-expiry handler.
    if (error.response?.status === 401 && error.config?.url !== '/auth/login') {
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('hrms_token');
        // Ignore unauthenticated requests and responses from an older session.
        if (!token || error.config?.headers?.Authorization !== `Bearer ${token}`) {
          return Promise.reject(error);
        }
        localStorage.removeItem('hrms_token');
        localStorage.removeItem('hrms_user');
        if (window.location.pathname !== '/login') {
          window.location.replace('/login');
        }
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Hands a blob to the browser as a download.
 *
 * The object URL is revoked straight after the click because the blob is held
 * in memory until it is, and a payroll return can be large.
 */
function downloadBlob(data: Blob, filename: string, contentType: string) {
  if (typeof window === 'undefined') return;
  const url = window.URL.createObjectURL(new Blob([data], { type: contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// Companies API (SUPER_ADMIN only)
export const companiesApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/companies', { params }),
  getById: (id: string) => api.get(`/companies/${id}`),
  getStats: () => api.get('/companies/stats'),
  create: (data: Record<string, unknown>) => api.post('/companies', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/companies/${id}`, data),
  uploadLogo: (id: string, formData: FormData) =>
    api.post(`/companies/${id}/logo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  toggleStatus: (id: string) => api.put(`/companies/${id}/toggle-status`),
  delete: (id: string) => api.delete(`/companies/${id}`),
};

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (email: string, password: string, role?: string) =>
    api.post('/auth/register', { email, password, role }),
  getProfile: () => api.get('/auth/me'),
};

// Employees API
export const employeesApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/employees', { params }),
  getById: (id: string) => api.get(`/employees/${id}`),
  get360View: (id: string) => api.get(`/employees/${id}/360`),
  getOrgChart: () => api.get('/employees/org-chart'),
  create: (data: Record<string, unknown>) => api.post('/employees', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/employees/${id}`, data),
  delete: (id: string) => api.delete(`/employees/${id}`),
};

// Departments API
export const departmentsApi = {
  getAll: () => api.get('/departments'),
  getHierarchy: () => api.get('/departments/hierarchy'),
  getById: (id: string) => api.get(`/departments/${id}`),
  create: (data: Record<string, unknown>) => api.post('/departments', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/departments/${id}`, data),
  delete: (id: string) => api.delete(`/departments/${id}`),
};

// Designations API
export const designationsApi = {
  getAll: () => api.get('/designations'),
  getById: (id: string) => api.get(`/designations/${id}`),
  create: (data: Record<string, unknown>) => api.post('/designations', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/designations/${id}`, data),
  delete: (id: string) => api.delete(`/designations/${id}`),
};

// Branches API
export const branchesApi = {
  getAll: () => api.get('/branches'),
  getById: (id: string) => api.get(`/branches/${id}`),
  create: (data: Record<string, unknown>) => api.post('/branches', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/branches/${id}`, data),
  delete: (id: string) => api.delete(`/branches/${id}`),
};

// Attendance API
export const attendanceApi = {
  clockIn: (latitude: number, longitude: number, data?: Record<string, unknown>) =>
    api.post('/attendance/clock-in', { latitude, longitude, ...data }),
  clockOut: (latitude?: number, longitude?: number, data?: Record<string, unknown>) =>
    api.post('/attendance/clock-out', { ...(latitude != null && { latitude }), ...(longitude != null && { longitude }), ...data }),
  getTodayStatus: () => api.get('/attendance/today'),
  getMyAttendance: (from: string, to: string) =>
    api.get('/attendance/me', { params: { from, to } }),
  getEmployeeAttendance: (employeeId: string, from: string, to: string) =>
    api.get(`/attendance/${employeeId}`, { params: { from, to } }),
  getSummary: (params: Record<string, unknown>) =>
    api.get('/attendance/summary', { params }),
  getPayableHours: (employeeId: string, from: string, to: string) =>
    api.get(`/attendance/${employeeId}/payable`, { params: { from, to } }),
  getPendingOtApprovals: () => api.get('/attendance/pending-ot-approvals'),
  approveOt: (id: string, otMinutesApproved: number, remarks?: string) =>
    api.post(`/attendance/${id}/approve-ot`, { otMinutesApproved, remarks }),
  createManual: (data: Record<string, unknown>) => api.post('/attendance/manual', data),
};

// Leave API
export const leaveApi = {
  getTypes: () => api.get('/leave/types'),
  getMyBalances: (year?: number) =>
    api.get('/leave/balances/me', { params: year ? { year } : {} }),
  getMyRequests: (params?: Record<string, unknown>) =>
    api.get('/leave/requests/me', { params }),
  getPendingApprovals: () => api.get('/leave/requests/pending-approvals'),
  createRequest: (data: Record<string, unknown>) => api.post('/leave/requests', data),
  cancelRequest: (id: string) => api.post(`/leave/requests/${id}/cancel`),
  approveRequest: (id: string, note?: string) =>
    api.post(`/leave/requests/${id}/approve`, { approverNote: note }),
  rejectRequest: (id: string, note?: string) =>
    api.post(`/leave/requests/${id}/reject`, { approverNote: note }),

  // Admin APIs
  createLeaveType: (data: Record<string, unknown>) => api.post('/leave/admin/types', data),
  updateLeaveType: (id: string, data: Record<string, unknown>) =>
    api.put(`/leave/admin/types/${id}`, data),
  deleteLeaveType: (id: string) => api.delete(`/leave/admin/types/${id}`),

  getAllBalances: (year?: number) =>
    api.get('/leave/admin/balances', { params: year ? { year } : {} }),
  getEmployeeBalance: (employeeId: string, year?: number) =>
    api.get(`/leave/admin/balances/${employeeId}`, { params: year ? { year } : {} }),
  updateEmployeeBalance: (employeeId: string, leaveTypeId: string, year: number, data: Record<string, unknown>) =>
    api.put(`/leave/admin/balances/${employeeId}/${leaveTypeId}?year=${year}`, data),
  initializeBalances: (data: { year: number; employeeIds?: string[] }) =>
    api.post('/leave/admin/balances/initialize', data),

  getAllRequests: (params?: Record<string, unknown>) =>
    api.get('/leave/admin/requests', { params }),
  getAnalytics: (year?: number) =>
    api.get('/leave/admin/analytics', { params: year ? { year } : {} }),
};

// Comp-Off API
export const compOffApi = {
  create: (data: Record<string, unknown>) => api.post('/leave/comp-off', data),
  getMyRequests: (params?: Record<string, unknown>) => api.get('/leave/comp-off/me', { params }),
  getPendingApprovals: () => api.get('/leave/comp-off/pending-approvals'),
  getAllRequests: (params?: Record<string, unknown>) => api.get('/leave/comp-off/all', { params }),
  approve: (id: string, note?: string) => api.post(`/leave/comp-off/${id}/approve`, { approverNote: note }),
  reject: (id: string, note?: string) => api.post(`/leave/comp-off/${id}/reject`, { approverNote: note }),
};

// Leave Accrual API
export const accrualApi = {
  // Rules
  getRules: () => api.get('/leave/admin/accrual/rules'),
  getRuleById: (id: string) => api.get(`/leave/admin/accrual/rules/${id}`),
  createRule: (data: Record<string, unknown>) =>
    api.post('/leave/admin/accrual/rules', data),
  updateRule: (id: string, data: Record<string, unknown>) =>
    api.put(`/leave/admin/accrual/rules/${id}`, data),
  deleteRule: (id: string) => api.delete(`/leave/admin/accrual/rules/${id}`),

  // Processing
  triggerAccrual: (data: {
    month: number;
    year: number;
    employeeIds?: string[];
    leaveTypeIds?: string[];
  }) => api.post('/leave/admin/accrual/calculate', data),

  // Runs
  getRuns: (params?: { year?: number; page?: number; limit?: number }) =>
    api.get('/leave/admin/accrual/runs', { params }),
  getRunById: (id: string) => api.get(`/leave/admin/accrual/runs/${id}`),
  getRunEntries: (id: string, params?: { page?: number; limit?: number }) =>
    api.get(`/leave/admin/accrual/runs/${id}/entries`, { params }),
};

// Holidays API
export const holidaysApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/holidays', { params }),
  getUpcoming: (limit?: number) =>
    api.get('/holidays/upcoming', { params: limit ? { limit } : {} }),
  getById: (id: string) => api.get(`/holidays/${id}`),
  create: (data: Record<string, unknown>) => api.post('/holidays', data),
  bulkCreate: (holidays: Record<string, unknown>[]) =>
    api.post('/holidays/bulk', { holidays }),
  update: (id: string, data: Record<string, unknown>) => api.put(`/holidays/${id}`, data),
  delete: (id: string) => api.delete(`/holidays/${id}`),
};

// Shifts API
export const shiftsApi = {
  getAll: () => api.get('/shifts'),
  getById: (id: string) => api.get(`/shifts/${id}`),
  create: (data: Record<string, unknown>) => api.post('/shifts', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/shifts/${id}`, data),
  delete: (id: string) => api.delete(`/shifts/${id}`),
  getAssignments: (activeOnly?: boolean) =>
    api.get('/shifts/assignments/list', { params: { activeOnly } }),
  assignShift: (data: Record<string, unknown>) => api.post('/shifts/assignments', data),
  bulkAssignShift: (data: Record<string, unknown>) => api.post('/shifts/assignments/bulk', data),
  getEmployeeShiftHistory: (employeeId: string) =>
    api.get(`/shifts/assignments/employee/${employeeId}`),
};

// Documents API
export const documentsApi = {
  getByEmployee: (employeeId: string, params?: Record<string, unknown>) =>
    api.get(`/employees/${employeeId}/documents`, { params }),
  upload: (employeeId: string, formData: FormData) =>
    api.post(`/employees/${employeeId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getById: (employeeId: string, docId: string) =>
    api.get(`/employees/${employeeId}/documents/${docId}`),
  download: (employeeId: string, docId: string) =>
    api.get(`/employees/${employeeId}/documents/${docId}/download`, {
      responseType: 'blob',
    }),
  verify: (employeeId: string, docId: string) =>
    api.post(`/employees/${employeeId}/documents/${docId}/verify`),
  delete: (employeeId: string, docId: string) =>
    api.delete(`/employees/${employeeId}/documents/${docId}`),

  // Document Expiry (Admin)
  getExpiring: (days?: number) =>
    api.get('/employees/documents/expiring', { params: days ? { days } : {} }),
  getExpired: () => api.get('/employees/documents/expired'),
  sendExpiryAlerts: (days?: number) =>
    api.post('/employees/documents/send-expiry-alerts', { days }),
};

// Self-Service API
export const selfServiceApi = {
  getProfile: () => api.get('/self-service/profile'),
  createChangeRequest: (data: Record<string, unknown>) =>
    api.post('/self-service/change-requests', data),
  createBatchChangeRequests: (changes: Array<{ fieldName: string; newValue: string; reason?: string }>) =>
    api.post('/self-service/change-requests/batch', { changes }),
  getMyChangeRequests: () => api.get('/self-service/change-requests'),

  // Admin
  getPendingReviews: () => api.get('/self-service/admin/change-requests/pending'),
  getAllChangeRequests: (params?: Record<string, unknown>) =>
    api.get('/self-service/admin/change-requests', { params }),
  reviewChangeRequest: (id: string, data: Record<string, unknown>) =>
    api.post(`/self-service/admin/change-requests/${id}/review`, data),
};

// Notifications API
export const notificationsApi = {
  getAll: (params?: Record<string, unknown>) =>
    api.get('/notifications', { params }),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markAsRead: (id: string) => api.post(`/notifications/${id}/read`),
  markAllAsRead: () => api.post('/notifications/read-all'),
  delete: (id: string) => api.delete(`/notifications/${id}`),
};

// Announcements API
export const announcementsApi = {
  getActive: () => api.get('/announcements/active'),
  getAll: (params?: Record<string, unknown>) =>
    api.get('/announcements', { params }),
  getById: (id: string) => api.get(`/announcements/${id}`),
  create: (data: Record<string, unknown>) => api.post('/announcements', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/announcements/${id}`, data),
  delete: (id: string) => api.delete(`/announcements/${id}`),
};

// Admin API
export const adminApi = {
  getDashboard: () => api.get('/admin/dashboard'),
  getAnalytics: () => api.get('/admin/analytics'),
  getOtRules: () => api.get('/admin/settings/ot-rules'),
  getOtRule: (id: string) => api.get(`/admin/settings/ot-rules/${id}`),
  createOtRule: (data: Record<string, unknown>) => api.post('/admin/settings/ot-rules', data),
  updateOtRule: (id: string, data: Record<string, unknown>) =>
    api.put(`/admin/settings/ot-rules/${id}`, data),
  deleteOtRule: (id: string) => api.delete(`/admin/settings/ot-rules/${id}`),
};

// Payroll API
export const payrollApi = {
  // Salary Structures
  getStructures: () => api.get('/payroll/structures'),
  getStructure: (id: string) => api.get(`/payroll/structures/${id}`),
  createStructure: (data: Record<string, unknown>) => api.post('/payroll/structures', data),
  updateStructure: (id: string, data: Record<string, unknown>) =>
    api.put(`/payroll/structures/${id}`, data),
  deleteStructure: (id: string) => api.delete(`/payroll/structures/${id}`),

  // Employee Salary
  getEmployeeSalary: (employeeId: string) =>
    api.get(`/payroll/employees/${employeeId}/salary`),
  assignSalary: (employeeId: string, data: Record<string, unknown>) =>
    api.post(`/payroll/employees/${employeeId}/salary`, data),

  // Payroll Runs
  getRuns: (params?: Record<string, unknown>) => api.get('/payroll/runs', { params }),
  getRun: (id: string) => api.get(`/payroll/runs/${id}`),
  createRun: (data: Record<string, unknown>) => api.post('/payroll/runs', data),
  processRun: (id: string) => api.post(`/payroll/runs/${id}/process`),
  approveRun: (id: string) => api.post(`/payroll/runs/${id}/approve`),
  markAsPaid: (id: string) => api.post(`/payroll/runs/${id}/pay`),
  deleteRun: (id: string) => api.delete(`/payroll/runs/${id}`),

  // Payslips
  getPayslipsForRun: (runId: string, params?: Record<string, unknown>) =>
    api.get(`/payroll/runs/${runId}/payslips`, { params }),
  getMyPayslips: () => api.get('/payroll/my-payslips'),
  getPayslip: (id: string) => api.get(`/payroll/payslips/${id}`),
  getEmployeePayslips: (employeeId: string) =>
    api.get(`/payroll/employees/${employeeId}/payslips`),
  downloadPayslip: async (id: string, filename: string) => {
    const response = await api.get(`/payroll/payslips/${id}/pdf`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};

// Exit / Separation API
export const exitApi = {
  initiate: (data: Record<string, unknown>) => api.post('/exit/separations', data),
  getAll: (params?: Record<string, unknown>) => api.get('/exit/separations', { params }),
  getById: (id: string) => api.get(`/exit/separations/${id}`),
  update: (id: string, data: Record<string, unknown>) => api.put(`/exit/separations/${id}`, data),
  moveToNoticePeriod: (id: string) => api.post(`/exit/separations/${id}/notice-period`),
  moveToClearance: (id: string) => api.post(`/exit/separations/${id}/clearance`),
  complete: (id: string) => api.post(`/exit/separations/${id}/complete`),
  cancel: (id: string) => api.post(`/exit/separations/${id}/cancel`),
};

// Letters API
export const lettersApi = {
  // Templates (Admin/HR)
  getTemplates: (params?: Record<string, unknown>) => api.get('/letters/templates', { params }),
  getTemplate: (id: string) => api.get(`/letters/templates/${id}`),
  createTemplate: (data: Record<string, unknown>) => api.post('/letters/templates', data),
  updateTemplate: (id: string, data: Record<string, unknown>) =>
    api.put(`/letters/templates/${id}`, data),
  deleteTemplate: (id: string) => api.delete(`/letters/templates/${id}`),

  // Generation
  generate: (data: { templateId: string; employeeId: string }) =>
    api.post('/letters/generate', data),
  getGenerated: () => api.get('/letters/generated'),
  getMyLetters: () => api.get('/letters/generated/me'),
  getGeneratedById: (id: string) => api.get(`/letters/generated/${id}`),
  downloadPdf: async (id: string, filename: string) => {
    const response = await api.get(`/letters/generated/${id}/pdf`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};

// Reports API
export const reportsApi = {
  generateAttendance: (data: Record<string, unknown>) =>
    api.post('/reports/attendance', data, { responseType: 'blob' }),
  generateLeave: (data: Record<string, unknown>) =>
    api.post('/reports/leave', data, { responseType: 'blob' }),
  generateEmployees: (data: Record<string, unknown>) =>
    api.post('/reports/employees', data, { responseType: 'blob' }),
};

// Expenses API
export const expensesApi = {
  // Categories (Admin)
  getCategories: () => api.get('/expenses/categories'),
  createCategory: (data: Record<string, unknown>) => api.post('/expenses/categories', data),
  updateCategory: (id: string, data: Record<string, unknown>) => api.put(`/expenses/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/expenses/categories/${id}`),

  // My Claims
  getMyClaims: (params?: Record<string, string>) => api.get('/expenses/my-claims', { params }),
  createClaim: (data: Record<string, unknown>) => api.post('/expenses/claims', data),
  updateClaim: (id: string, data: Record<string, unknown>) => api.put(`/expenses/claims/${id}`, data),
  submitClaim: (id: string) => api.post(`/expenses/claims/${id}/submit`),
  deleteClaim: (id: string) => api.delete(`/expenses/claims/${id}`),

  // Approvals
  getPendingApprovals: (params?: Record<string, string>) => api.get('/expenses/pending-approvals', { params }),
  getAllClaims: (params?: Record<string, string>) => api.get('/expenses/all-claims', { params }),
  approveClaim: (id: string, data?: Record<string, unknown>) => api.post(`/expenses/claims/${id}/approve`, data),
  rejectClaim: (id: string, data?: Record<string, unknown>) => api.post(`/expenses/claims/${id}/reject`, data),
  markReimbursed: (id: string) => api.post(`/expenses/claims/${id}/reimburse`),
};

// Onboarding API
export const onboardingApi = {
  // Templates (Admin)
  getTemplates: () => api.get('/onboarding/templates'),
  getTemplate: (id: string) => api.get(`/onboarding/templates/${id}`),
  createTemplate: (data: Record<string, unknown>) => api.post('/onboarding/templates', data),
  updateTemplate: (id: string, data: Record<string, unknown>) =>
    api.put(`/onboarding/templates/${id}`, data),
  deleteTemplate: (id: string) => api.delete(`/onboarding/templates/${id}`),

  // Processes (Admin)
  getProcesses: (params?: Record<string, string>) =>
    api.get('/onboarding/processes', { params }),
  getProcess: (id: string) => api.get(`/onboarding/processes/${id}`),
  createProcess: (data: Record<string, unknown>) => api.post('/onboarding/processes', data),
  cancelProcess: (id: string) => api.post(`/onboarding/processes/${id}/cancel`),
  deleteProcess: (id: string) => api.delete(`/onboarding/processes/${id}`),

  // Tasks
  getMyTasks: (params?: Record<string, string>) =>
    api.get('/onboarding/my-tasks', { params }),
  updateTask: (id: string, data: Record<string, unknown>) =>
    api.put(`/onboarding/tasks/${id}`, data),
  completeTask: (id: string) => api.post(`/onboarding/tasks/${id}/complete`),
};

// ============================================
// ATTENDANCE REGULARIZATION
// ============================================
export const regularizationApi = {
  create: (data: Record<string, unknown>) => api.post('/attendance/regularization', data),
  getMyRequests: (params?: Record<string, unknown>) => api.get('/attendance/regularization/me', { params }),
  getPendingApprovals: () => api.get('/attendance/regularization/pending-approvals'),
  getAllRequests: (params?: Record<string, unknown>) => api.get('/attendance/regularization/all', { params }),
  approve: (id: string, note?: string) => api.post(`/attendance/regularization/${id}/approve`, { approverNote: note }),
  reject: (id: string, note?: string) => api.post(`/attendance/regularization/${id}/reject`, { approverNote: note }),
};

// ============================================
// AUDIT
// ============================================
export const auditApi = {
  getLogs: (params?: Record<string, string>) =>
    api.get('/audit', { params }),
  getEntityHistory: (entityType: string, entityId: string) =>
    api.get(`/audit/entity/${entityType}/${entityId}`),
};

// ============================================
// PERFORMANCE MANAGEMENT
// ============================================
export const performanceApi = {
  // Cycles (Admin)
  getCycles: (params?: Record<string, string>) =>
    api.get('/performance/cycles', { params }),
  getCycle: (id: string) => api.get(`/performance/cycles/${id}`),
  createCycle: (data: Record<string, unknown>) =>
    api.post('/performance/cycles', data),
  updateCycle: (id: string, data: Record<string, unknown>) =>
    api.put(`/performance/cycles/${id}`, data),
  deleteCycle: (id: string) => api.delete(`/performance/cycles/${id}`),
  launchCycle: (id: string) => api.post(`/performance/cycles/${id}/launch`),
  completeCycle: (id: string) => api.post(`/performance/cycles/${id}/complete`),

  // My Reviews
  getMyReviews: (params?: Record<string, string>) =>
    api.get('/performance/my-reviews', { params }),
  getReview: (id: string) => api.get(`/performance/reviews/${id}`),
  submitSelfReview: (id: string, data: Record<string, unknown>) =>
    api.post(`/performance/reviews/${id}/self-review`, data),

  // Team Reviews (Manager/HR)
  getTeamReviews: (params?: Record<string, string>) =>
    api.get('/performance/team-reviews', { params }),
  submitManagerReview: (id: string, data: Record<string, unknown>) =>
    api.post(`/performance/reviews/${id}/manager-review`, data),

  // Goals
  getMyGoals: () => api.get('/performance/my-goals'),
  createGoal: (data: Record<string, unknown>) =>
    api.post('/performance/goals', data),
  updateGoal: (id: string, data: Record<string, unknown>) =>
    api.put(`/performance/goals/${id}`, data),
  deleteGoal: (id: string) => api.delete(`/performance/goals/${id}`),
};

// ============================================
// BIOMETRIC DEVICE MANAGEMENT
// ============================================
export const biometricApi = {
  // Devices
  listDevices: () => api.get('/biometric/devices'),
  registerDevice: (data: Record<string, unknown>) => api.post('/biometric/devices', data),
  updateDevice: (deviceId: string, data: Record<string, unknown>) =>
    api.patch(`/biometric/devices/${deviceId}`, data),
  getDeviceLogs: (deviceId: string, limit?: number) =>
    api.get(`/biometric/devices/${deviceId}/logs`, { params: limit ? { limit } : {} }),
  // Employee mapping
  setEmployeeBiometricId: (employeeId: string, biometricUserId: string) =>
    api.patch(`/biometric/employees/${employeeId}`, { biometricUserId }),
};

// ============================================
// STATUTORY RETURN AND CHALLAN FILES
// ============================================
/**
 * Files are generated from a payroll run that has been computed. A run still in
 * draft is refused by the server, deliberately: a return filed from figures
 * that may still change is worse than no return.
 *
 * `preview` asks for the whole object as JSON so the warnings can be shown
 * before anyone files anything. `download` streams the file itself.
 */
export const returnsApi = {
  preview: (payrollRunId: string, kind: StatutoryReturnKind) =>
    api.get(`/payroll/returns/${payrollRunId}/${kind}`, { params: { download: 'false' } }),
  download: async (payrollRunId: string, kind: StatutoryReturnKind, filename: string) => {
    const response = await api.get(`/payroll/returns/${payrollRunId}/${kind}`, {
      responseType: 'blob',
    });
    downloadBlob(response.data as Blob, filename, 'text/plain');
  },
  /** Saves a preview the caller already holds, without a second round trip. */
  saveContent: (content: string, filename: string, contentType = 'text/plain') => {
    downloadBlob(new Blob([content], { type: contentType }), filename, contentType);
  },
};

// ============================================
// FORM 16 (PART B ONLY)
// ============================================
/**
 * Part A is issued by TRACES against the returns actually filed and is not
 * available here. Anything that imitated it would be a forgery.
 */
export const form16Api = {
  getMine: (financialYear: number) => api.get(`/payroll/form16/my/${financialYear}`),
  getMyQuarters: (financialYear: number) =>
    api.get(`/payroll/form16/my/${financialYear}/quarters`),
  downloadMine: async (financialYear: number, filename: string) => {
    const response = await api.get(`/payroll/form16/my/${financialYear}/pdf`, {
      responseType: 'blob',
    });
    downloadBlob(response.data as Blob, filename, 'application/pdf');
  },

  getForEmployee: (employeeId: string, financialYear: number) =>
    api.get(`/payroll/form16/${employeeId}/${financialYear}`),
  getQuartersForEmployee: (employeeId: string, financialYear: number) =>
    api.get(`/payroll/form16/${employeeId}/${financialYear}/quarters`),
  downloadForEmployee: async (
    employeeId: string,
    financialYear: number,
    filename: string,
  ) => {
    const response = await api.get(`/payroll/form16/${employeeId}/${financialYear}/pdf`, {
      responseType: 'blob',
    });
    downloadBlob(response.data as Blob, filename, 'application/pdf');
  },
};

// ============================================
// FULL AND FINAL SETTLEMENT
// ============================================
export const settlementApi = {
  /** Recomputes from the separation, replacing any existing draft. */
  compute: (separationId: string, data?: { waiveGratuityMinimumService?: boolean }) =>
    api.post(`/exit/settlements/separations/${separationId}/compute`, data ?? {}),
  getBySeparation: (separationId: string) =>
    api.get(`/exit/settlements/separations/${separationId}`),
  getById: (id: string) => api.get(`/exit/settlements/${id}`),
  update: (id: string, data: UpdateSettlementPayload) =>
    api.put(`/exit/settlements/${id}`, data),
  approve: (id: string) => api.post(`/exit/settlements/${id}/approve`),
  markAsPaid: (id: string) => api.post(`/exit/settlements/${id}/pay`),
};

// ============================================
// STATUTORY CONFIGURATION AND TAX DECLARATIONS
// ============================================
/**
 * Rates and slabs are data, not code.
 *
 * `getConfig` resolves with `null` when the tenant has never configured
 * statutory payroll. That is not an error and must not be shown as one: with no
 * row, nothing statutory is deducted and payroll behaves exactly as it did
 * before the feature existed.
 *
 * Slab tables are read-only here. They are seeded per state and financial year,
 * and editing a slab is a migration, not a form.
 */
export const statutoryApi = {
  getConfig: () => api.get('/payroll/statutory/config'),
  updateConfig: (data: UpdateStatutoryConfigPayload) =>
    api.put('/payroll/statutory/config', data),

  getProfessionalTaxSlabs: (state?: string) =>
    api.get('/payroll/statutory/professional-tax-slabs', {
      params: state ? { state } : undefined,
    }),
  getIncomeTaxConfig: (financialYear?: number) =>
    api.get('/payroll/statutory/income-tax-config', {
      params: financialYear ? { financialYear } : undefined,
    }),

  getMyDeclaration: (financialYear?: number) =>
    api.get('/payroll/statutory/my-declaration', {
      params: financialYear ? { financialYear } : undefined,
    }),
  saveMyDeclaration: (data: UpsertTaxDeclarationPayload) =>
    api.put('/payroll/statutory/my-declaration', data),
  /** Payroll staff reading an employee's declaration. Read only by design. */
  getDeclarationFor: (employeeId: string, financialYear?: number) =>
    api.get(`/payroll/statutory/declarations/${employeeId}`, {
      params: financialYear ? { financialYear } : undefined,
    }),
};

// ============================================
// INVESTMENT PROOFS
// ============================================
/**
 * Evidence behind a declared deduction, and its review.
 *
 * Submitting is two steps: the file goes to the generic uploads endpoint first,
 * and the proof then references the upload it produced. That keeps one place
 * responsible for file validation and storage.
 */
export const PROOF_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** What the uploads endpoint accepts. Anything else is refused with a 422. */
export const PROOF_ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
] as const;

export const proofsApi = {
  /** Step one: store the file. Returns the `Upload`, whose `id` the proof needs. */
  uploadFile: (file: File, financialYear: number) => {
    const form = new FormData();
    form.append('file', file);
    form.append('entityType', 'investment-proof');
    form.append('entityId', String(financialYear));
    return api.post('/uploads', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // The employee's own proofs.
  submit: (data: SubmitProofPayload) => api.post('/payroll/proofs', data),
  listMine: (financialYear: number) =>
    api.get('/payroll/proofs/mine', { params: { financialYear } }),
  mySummary: (financialYear: number) =>
    api.get('/payroll/proofs/mine/summary', { params: { financialYear } }),
  /** Only a proof still pending can be withdrawn; a reviewed one is a record. */
  withdraw: (id: string) => api.delete(`/payroll/proofs/${id}`),

  // Review, for payroll staff.
  listForReview: (params?: Record<string, unknown>) =>
    api.get('/payroll/proofs', { params }),
  summaryFor: (employeeId: string, financialYear: number) =>
    api.get(`/payroll/proofs/employees/${employeeId}/summary`, {
      params: { financialYear },
    }),
  approve: (id: string, data: ReviewProofPayload) =>
    api.post(`/payroll/proofs/${id}/approve`, data),
  reject: (id: string, data: ReviewProofPayload) =>
    api.post(`/payroll/proofs/${id}/reject`, data),

  /** Opens the stored document. Both the owner and payroll staff may read it. */
  download: async (id: string, filename: string) => {
    const response = await api.get(`/payroll/proofs/${id}/file`, {
      responseType: 'blob',
    });
    downloadBlob(response.data as Blob, filename, 'application/octet-stream');
  },
};
