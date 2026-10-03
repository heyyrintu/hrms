import { api } from '@/lib/api';

export type Band = 'LOW' | 'MEDIUM' | 'HIGH';
export interface Distribution { '1': number; '2': number; '3': number; '4': number; '5': number; unrated: number; total: number }
export interface CalibrationRow { reviewId: string; employeeId: string; employeeName: string; employeeCode: string;
  departmentName: string; reviewerName: string; status: string; managerRating: number | null; overallRating: number | null;
  calibratedRating: number | null; calibrationReason: string | null; finalRating: number | null; potentialRating: number | null }
export interface CalibrationView { cycle: { id: string; name: string; status: string }; overall: Distribution;
  byDepartment: Array<{ departmentId: string | null; departmentName: string; distribution: Distribution }>;
  byManager: Array<{ reviewerId: string; reviewerName: string; distribution: Distribution }>;
  reviews: CalibrationRow[] }
export interface NineBoxPerson { reviewId: string; employeeId: string; name: string; designation: string | null;
  departmentName: string | null; finalRating: number; potentialRating: number }
export interface NineBoxView { cells: Array<{ performance: Band; potential: Band; employees: NineBoxPerson[] }>;
  missing: Array<{ reviewId: string; employeeId: string; name: string; missingRating: boolean; missingPotential: boolean }> }
export const calibrationApi = {
  get: (params: { cycleId: string; departmentId?: string; managerId?: string }) => api.get<CalibrationView>('/performance/calibration', { params }),
  calibrate: (reviewId: string, rating: number | null, reason: string) =>
    api.post(`/performance/reviews/${reviewId}/calibrate`, { rating, reason }),
  nineBox: (params: { cycleId: string; departmentId?: string }) => api.get<NineBoxView>('/performance/nine-box', { params }),
};
