import axios from 'axios';
import type {
  EmploymentType,
  JobOfferStatus,
  PreOnboardingPersonalDetails,
  PreOnboardingStatus,
} from '@/lib/api-recruitment';

/**
 * Public, unauthenticated hiring endpoints (Keka wave D): careers page,
 * offer accept/decline, pre-onboarding portal.
 *
 * Deliberately NOT the shared `api` instance: these pages are opened by
 * candidates with no session, and must neither attach a stray HR token from
 * the same browser nor trigger the session-expiry redirect on a 401.
 * Types mirror `backend/src/modules/recruitment/recruitment.types.ts`.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const publicApi = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

export interface PublicJobSummary {
  slug: string;
  title: string;
  location: string | null;
  department: string | null;
  employmentType: EmploymentType;
  experienceMin: number | null;
  experienceMax: number | null;
  publishedAt: string | null;
}

export interface PublicCareers {
  company: {
    name: string;
    logoUrl: string | null;
    website: string | null;
    description: string | null;
    careersIntro: string | null;
  };
  jobs: PublicJobSummary[];
}

export interface PublicJob extends PublicJobSummary {
  description: string;
  requirements: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  company: { name: string; logoUrl: string | null };
}

export interface CareersApplicationFields {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  currentCompany?: string;
  currentTitle?: string;
  totalExperienceYears?: number;
  linkedinUrl?: string;
  coverLetter?: string;
  /** Honeypot: must stay empty. Rendered hidden from people, visible to bots. */
  website?: string;
}

export interface PublicOffer {
  company: { name: string; logoUrl: string | null };
  candidateFirstName: string;
  jobTitle: string;
  content: string;
  annualCtc: number;
  joiningDate: string;
  expiresAt: string | null;
  status: JobOfferStatus;
  respondedAt: string | null;
}

export interface PublicPreOnboardingDocument {
  key: string;
  label: string;
  required: boolean;
  uploaded: boolean;
  fileName: string | null;
  uploadedAt: string | null;
}

export interface PublicPreOnboarding {
  company: { name: string; logoUrl: string | null };
  employeeFirstName: string;
  joinDate: string;
  status: PreOnboardingStatus;
  expiresAt: string;
  documents: PublicPreOnboardingDocument[];
  personalDetails: PreOnboardingPersonalDetails | null;
}

const enc = encodeURIComponent;

export const careersApi = {
  getCareers: (tenantCode: string) =>
    publicApi.get<PublicCareers>(`/public/careers/${enc(tenantCode)}`),
  getJob: (tenantCode: string, slug: string) =>
    publicApi.get<PublicJob>(`/public/careers/${enc(tenantCode)}/jobs/${enc(slug)}`),
  apply: (tenantCode: string, slug: string, fields: CareersApplicationFields, resume: File) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }
    form.append('resume', resume);
    return publicApi.post<{ message: string }>(
      `/public/careers/${enc(tenantCode)}/jobs/${enc(slug)}/apply`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },
};

export const publicOfferApi = {
  get: (token: string) => publicApi.get<PublicOffer>(`/public/offers/${enc(token)}`),
  accept: (token: string, acceptedName: string) =>
    publicApi.post<PublicOffer>(`/public/offers/${enc(token)}/accept`, { acceptedName }),
  decline: (token: string, reason?: string) =>
    publicApi.post<PublicOffer>(`/public/offers/${enc(token)}/decline`, { reason }),
};

export const preOnboardingApi = {
  get: (token: string) =>
    publicApi.get<PublicPreOnboarding>(`/public/pre-onboarding/${enc(token)}`),
  saveDetails: (token: string, details: PreOnboardingPersonalDetails) =>
    publicApi.put<PublicPreOnboarding>(`/public/pre-onboarding/${enc(token)}/details`, details),
  uploadDocument: (token: string, documentKey: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return publicApi.post<PublicPreOnboarding>(
      `/public/pre-onboarding/${enc(token)}/documents/${enc(documentKey)}`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },
  submit: (token: string) =>
    publicApi.post<PublicPreOnboarding>(`/public/pre-onboarding/${enc(token)}/submit`),
};
