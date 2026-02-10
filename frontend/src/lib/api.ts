import axios from 'axios';

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
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('hrms_token');
        localStorage.removeItem('hrms_user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

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

// Attendance API
export const attendanceApi = {
  clockIn: (data?: Record<string, unknown>) => api.post('/attendance/clock-in', data || {}),
  clockOut: (data?: Record<string, unknown>) => api.post('/attendance/clock-out', data || {}),
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
};

// Self-Service API
export const selfServiceApi = {
  getProfile: () => api.get('/self-service/profile'),
  createChangeRequest: (data: Record<string, unknown>) =>
    api.post('/self-service/change-requests', data),
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
