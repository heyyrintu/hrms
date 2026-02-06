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
  approveOt: (id: string, otMinutesApproved: number) =>
    api.post(`/attendance/${id}/approve-ot`, { otMinutesApproved }),
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
