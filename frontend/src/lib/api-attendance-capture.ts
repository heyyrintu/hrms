import { api } from '@/lib/api';

/**
 * Attendance capture policy and selfies (Keka wave G). Frozen contract: types
 * and function signatures mirror `backend/src/modules/attendance/capture`.
 */

export interface CapturePolicyStatus {
  ipRestrictionEnabled: boolean;
  ipAllowed: boolean;
  selfieRequired: boolean;
  coveringRequest: { id: string; type: 'WFH' | 'ON_DUTY' } | null;
  clientIp: string | null;
}

export const attendanceCaptureApi = {
  getPolicy: () => api.get<CapturePolicyStatus>('/attendance-capture/policy'),
  uploadSelfie: (file: Blob) => {
    const form = new FormData();
    form.append('file', file, 'selfie.jpg');
    return api.post<{ uploadId: string }>('/attendance-capture/selfie', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getSelfie: (sessionId: string, which: 'in' | 'out') =>
    api.get<Blob>(`/attendance-capture/selfies/${sessionId}/${which}`, { responseType: 'blob' }),
};
