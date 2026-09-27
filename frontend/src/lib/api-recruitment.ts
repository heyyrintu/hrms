import { api } from '@/lib/api';

/**
 * Hiring / applicant tracking (Keka wave D), authenticated endpoints.
 * Public endpoints (careers page, offer answer, pre-onboarding portal) live in
 * `api-careers.ts`.
 *
 * Types mirror `backend/src/modules/recruitment/recruitment.types.ts`.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part D.
 */

export type EmploymentType = 'PERMANENT' | 'CONTRACT' | 'TEMPORARY' | 'INTERN';
export type JobRequisitionStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FILLED';
export type JobOpeningStatus = 'DRAFT' | 'OPEN' | 'ON_HOLD' | 'CLOSED';
export type PipelineStageCategory =
  | 'APPLIED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'HIRED'
  | 'REJECTED';
export type CandidateSource =
  | 'CAREERS_PAGE'
  | 'REFERRAL'
  | 'AGENCY'
  | 'JOB_BOARD'
  | 'DIRECT'
  | 'OTHER';
export type JobApplicationStatus = 'ACTIVE' | 'REJECTED' | 'WITHDRAWN' | 'HIRED';
export type InterviewMode = 'IN_PERSON' | 'VIDEO' | 'PHONE';
export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type InterviewRecommendation = 'STRONG_HIRE' | 'HIRE' | 'NO_HIRE' | 'STRONG_NO_HIRE';
export type JobOfferStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'WITHDRAWN';
export type PreOnboardingStatus =
  | 'INVITED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'COMPLETED'
  | 'REVOKED'
  | 'EXPIRED';
export type DocumentCategory =
  | 'ID_PROOF'
  | 'ADDRESS_PROOF'
  | 'EDUCATION'
  | 'EMPLOYMENT'
  | 'CONTRACT'
  | 'CERTIFICATE'
  | 'TAX'
  | 'OTHER';

export interface NamedRef {
  id: string;
  name: string;
}

export interface EmployeeSummary {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
}

// ---- D1 ---------------------------------------------------------------------

export interface Requisition {
  id: string;
  title: string;
  department: NamedRef | null;
  designation: NamedRef | null;
  hiringManager: EmployeeSummary | null;
  headcount: number;
  filledCount: number;
  employmentType: EmploymentType;
  budgetMin: number | null;
  budgetMax: number | null;
  justification: string | null;
  status: JobRequisitionStatus;
  requestedBy: { userId: string; name: string };
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  openingsCount: number;
  createdAt: string;
}

export interface RequisitionPayload {
  title: string;
  departmentId?: string | null;
  designationId?: string | null;
  hiringManagerId?: string | null;
  headcount: number;
  employmentType?: EmploymentType;
  budgetMin?: number | null;
  budgetMax?: number | null;
  justification?: string | null;
}

export interface JobOpening {
  id: string;
  requisitionId: string | null;
  title: string;
  slug: string;
  description: string;
  requirements: string | null;
  location: string | null;
  department: NamedRef | null;
  designation: NamedRef | null;
  branch: NamedRef | null;
  employmentType: EmploymentType;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  showSalary: boolean;
  isPublic: boolean;
  positions: number;
  hiringManager: EmployeeSummary | null;
  status: JobOpeningStatus;
  publishedAt: string | null;
  closedAt: string | null;
  applicationCounts: Record<string, number>;
  createdAt: string;
}

export interface JobOpeningPayload {
  requisitionId?: string | null;
  title: string;
  description: string;
  requirements?: string | null;
  location?: string | null;
  departmentId?: string | null;
  designationId?: string | null;
  branchId?: string | null;
  employmentType?: EmploymentType;
  experienceMin?: number | null;
  experienceMax?: number | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  showSalary?: boolean;
  isPublic?: boolean;
  positions?: number;
  hiringManagerId?: string | null;
}

export interface PipelineStage {
  id: string;
  name: string;
  sortOrder: number;
  category: PipelineStageCategory;
  isActive: boolean;
}

export interface PipelineStagePayload {
  /** Present for an existing stage (rename / reorder), absent for a new one. */
  id?: string;
  name: string;
  category: PipelineStageCategory;
}

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  totalExperienceYears: number | null;
  currentCtc: number | null;
  expectedCtc: number | null;
  noticePeriodDays: number | null;
  location: string | null;
  linkedinUrl: string | null;
  source: CandidateSource;
  referredBy: EmployeeSummary | null;
  resumeKey: string | null;
  resumeFileName: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ApplicationSummary {
  id: string;
  jobOpening: { id: string; title: string };
  stage: PipelineStage;
  status: JobApplicationStatus;
  appliedAt: string;
}

export interface CandidateDetail extends Candidate {
  applications: ApplicationSummary[];
}

export interface CandidatePayload {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  totalExperienceYears?: number | null;
  currentCtc?: number | null;
  expectedCtc?: number | null;
  noticePeriodDays?: number | null;
  location?: string | null;
  linkedinUrl?: string | null;
  source?: CandidateSource;
  referredByEmployeeId?: string | null;
  /** Id of an Upload made through POST /uploads (entityType CANDIDATE_RESUME). */
  resumeUploadId?: string | null;
  notes?: string | null;
}

export interface ApplicationCard {
  id: string;
  candidate: { id: string; firstName: string; lastName: string; email: string; currentTitle: string | null };
  stage: PipelineStage;
  status: JobApplicationStatus;
  source: CandidateSource;
  appliedAt: string;
  stageChangedAt: string;
  interviewCount: number;
}

export interface StageEvent {
  id: string;
  fromStage: { id: string; name: string } | null;
  toStage: { id: string; name: string };
  movedBy: { userId: string; name: string } | null;
  note: string | null;
  createdAt: string;
}

export interface ApplicationDetail {
  id: string;
  candidate: Candidate;
  jobOpening: { id: string; title: string; hiringManagerId: string | null; requisitionId: string | null };
  stage: PipelineStage;
  status: JobApplicationStatus;
  source: CandidateSource;
  resumeKey: string | null;
  resumeFileName: string | null;
  coverLetter: string | null;
  rejectionReason: string | null;
  appliedAt: string;
  stageChangedAt: string;
  hiredAt: string | null;
  history: StageEvent[];
}

// ---- D2 ---------------------------------------------------------------------

export interface Interview {
  id: string;
  applicationId: string;
  candidate: { id: string; firstName: string; lastName: string };
  jobOpening: { id: string; title: string };
  roundName: string;
  scheduledStart: string;
  scheduledEnd: string;
  mode: InterviewMode;
  location: string | null;
  meetingLink: string | null;
  status: InterviewStatus;
  notes: string | null;
  panel: EmployeeSummary[];
  feedbackSubmittedBy: string[];
  myFeedbackDue: boolean;
}

export interface InterviewPayload {
  roundName: string;
  scheduledStart: string;
  scheduledEnd: string;
  mode: InterviewMode;
  location?: string | null;
  meetingLink?: string | null;
  notes?: string | null;
  panelEmployeeIds: string[];
}

export interface FeedbackScore {
  criterion: string;
  rating: number;
  comment?: string | null;
}

export interface InterviewFeedback {
  id: string;
  interviewId: string;
  interviewer: EmployeeSummary;
  overallRating: number;
  recommendation: InterviewRecommendation;
  scores: FeedbackScore[];
  strengths: string | null;
  concerns: string | null;
  submittedAt: string;
}

export interface InterviewFeedbackList {
  visible: boolean;
  items: InterviewFeedback[];
}

export interface FeedbackPayload {
  overallRating: number;
  recommendation: InterviewRecommendation;
  scores: FeedbackScore[];
  strengths?: string | null;
  concerns?: string | null;
}

export interface Offer {
  id: string;
  applicationId: string;
  candidate: { id: string; firstName: string; lastName: string; email: string };
  jobOpening: { id: string; title: string };
  template: NamedRef;
  content: string;
  designation: NamedRef | null;
  department: NamedRef | null;
  branch: NamedRef | null;
  reportingManager: EmployeeSummary | null;
  employmentType: EmploymentType;
  annualCtc: number;
  monthlyBasePay: number | null;
  salaryStructure: NamedRef | null;
  joiningDate: string;
  expiresAt: string | null;
  status: JobOfferStatus;
  sentAt: string | null;
  respondedAt: string | null;
  acceptedName: string | null;
  declineReason: string | null;
  decisionNote: string | null;
  employeeId: string | null;
  convertedAt: string | null;
  createdAt: string;
}

export interface OfferPayload {
  templateId: string;
  designationId?: string | null;
  departmentId?: string | null;
  branchId?: string | null;
  reportingManagerId?: string | null;
  employmentType?: EmploymentType;
  annualCtc: number;
  monthlyBasePay?: number | null;
  salaryStructureId?: string | null;
  /** YYYY-MM-DD */
  joiningDate: string;
  expiresAt?: string | null;
}

export interface OfferConversionPayload {
  employeeCode: string;
  createUser?: boolean;
  userEmail?: string;
  userPassword?: string;
  onboardingTemplateId?: string | null;
}

export interface OfferConversionResult {
  employeeId: string;
  onboardingProcessId: string | null;
  employeeSalaryId: string | null;
}

// ---- D3 (authenticated side) ------------------------------------------------

export interface PreOnboardingDocumentDefinition {
  key: string;
  label: string;
  category: DocumentCategory;
  required: boolean;
}

export interface RecruitmentSettings {
  careersPageEnabled: boolean;
  careersIntro: string | null;
  offerExpiryDays: number;
  preOnboardingExpiryDays: number;
  preOnboardingDocuments: PreOnboardingDocumentDefinition[];
  careersUrl: string;
}

export interface PreOnboardingPersonalDetails {
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  bloodGroup?: string | null;
  fatherName?: string | null;
  personalEmail?: string | null;
  mobileNumber?: string | null;
  currentAddress?: string | null;
  currentCity?: string | null;
  currentState?: string | null;
  currentZipCode?: string | null;
  currentCountry?: string | null;
  permanentAddress?: string | null;
  permanentCity?: string | null;
  permanentState?: string | null;
  permanentZipCode?: string | null;
  permanentCountry?: string | null;
  emergencyContactName?: string | null;
  emergencyContactNumber?: string | null;
  emergencyContactRelation?: string | null;
}

export interface PreOnboardingDocumentState extends PreOnboardingDocumentDefinition {
  uploaded: boolean;
  fileName: string | null;
  uploadedAt: string | null;
  verified: boolean;
}

export interface PreOnboardingInvite {
  id: string;
  employee: EmployeeSummary & { joinDate: string };
  offerId: string | null;
  status: PreOnboardingStatus;
  expiresAt: string;
  submittedAt: string | null;
  lastAccessedAt: string | null;
  documents: PreOnboardingDocumentState[];
  personalDetails: PreOnboardingPersonalDetails | null;
  createdAt: string;
}

export interface PreOnboardingInviteCreated {
  invite: PreOnboardingInvite;
  link: string;
}

export interface PreOnboardingInvitePayload {
  employeeId: string;
  offerId?: string | null;
  requiredDocuments?: PreOnboardingDocumentDefinition[];
  expiresInDays?: number;
}

export interface FunnelStageRow {
  stageId: string;
  name: string;
  category: PipelineStageCategory;
  reached: number;
  current: number;
  conversionFromPrevious: number | null;
  avgDaysInStage: number | null;
}

export interface FunnelReport {
  jobOpeningId: string | null;
  from: string | null;
  to: string | null;
  stages: FunnelStageRow[];
  totals: {
    applied: number;
    hired: number;
    rejected: number;
    withdrawn: number;
    offersSent: number;
    offersAccepted: number;
    offersDeclined: number;
    offerAcceptanceRate: number | null;
    avgTimeToHireDays: number | null;
  };
  bySource: Array<{ source: CandidateSource; count: number }>;
}

export const recruitmentApi = {
  // D1 — requisitions
  listRequisitions: (params?: { status?: JobRequisitionStatus }) =>
    api.get<Requisition[]>('/recruitment/requisitions', { params }),
  getRequisition: (id: string) => api.get<Requisition>(`/recruitment/requisitions/${id}`),
  createRequisition: (payload: RequisitionPayload) =>
    api.post<Requisition>('/recruitment/requisitions', payload),
  updateRequisition: (id: string, payload: Partial<RequisitionPayload>) =>
    api.patch<Requisition>(`/recruitment/requisitions/${id}`, payload),
  submitRequisition: (id: string) =>
    api.post<Requisition>(`/recruitment/requisitions/${id}/submit`),
  cancelRequisition: (id: string) =>
    api.post<Requisition>(`/recruitment/requisitions/${id}/cancel`),

  // D1 — openings
  listOpenings: (params?: { status?: JobOpeningStatus }) =>
    api.get<JobOpening[]>('/recruitment/openings', { params }),
  getOpening: (id: string) => api.get<JobOpening>(`/recruitment/openings/${id}`),
  createOpening: (payload: JobOpeningPayload) =>
    api.post<JobOpening>('/recruitment/openings', payload),
  updateOpening: (id: string, payload: Partial<JobOpeningPayload>) =>
    api.patch<JobOpening>(`/recruitment/openings/${id}`, payload),
  publishOpening: (id: string) => api.post<JobOpening>(`/recruitment/openings/${id}/publish`),
  holdOpening: (id: string) => api.post<JobOpening>(`/recruitment/openings/${id}/hold`),
  closeOpening: (id: string) => api.post<JobOpening>(`/recruitment/openings/${id}/close`),
  listOpeningApplications: (id: string) =>
    api.get<ApplicationCard[]>(`/recruitment/openings/${id}/applications`),

  // D1 — pipeline stages
  listStages: () => api.get<PipelineStage[]>('/recruitment/pipeline-stages'),
  replaceStages: (stages: PipelineStagePayload[]) =>
    api.put<PipelineStage[]>('/recruitment/pipeline-stages', { stages }),

  // D1 — candidates
  listCandidates: (params?: { search?: string }) =>
    api.get<Candidate[]>('/recruitment/candidates', { params }),
  getCandidate: (id: string) => api.get<CandidateDetail>(`/recruitment/candidates/${id}`),
  createCandidate: (payload: CandidatePayload) =>
    api.post<Candidate>('/recruitment/candidates', payload),
  updateCandidate: (id: string, payload: Partial<CandidatePayload>) =>
    api.patch<Candidate>(`/recruitment/candidates/${id}`, payload),

  // D1 — applications
  createApplication: (payload: { candidateId: string; jobOpeningId: string; source?: CandidateSource }) =>
    api.post<ApplicationDetail>('/recruitment/applications', payload),
  getApplication: (id: string) => api.get<ApplicationDetail>(`/recruitment/applications/${id}`),
  moveApplication: (id: string, payload: { stageId: string; note?: string }) =>
    api.post<ApplicationDetail>(`/recruitment/applications/${id}/move`, payload),
  rejectApplication: (id: string, reason: string) =>
    api.post<ApplicationDetail>(`/recruitment/applications/${id}/reject`, { reason }),
  withdrawApplication: (id: string) =>
    api.post<ApplicationDetail>(`/recruitment/applications/${id}/withdraw`),

  // D2 — interviews and feedback
  listInterviews: (applicationId: string) =>
    api.get<Interview[]>(`/recruitment/applications/${applicationId}/interviews`),
  scheduleInterview: (applicationId: string, payload: InterviewPayload) =>
    api.post<Interview>(`/recruitment/applications/${applicationId}/interviews`, payload),
  updateInterview: (id: string, payload: Partial<InterviewPayload>) =>
    api.patch<Interview>(`/recruitment/interviews/${id}`, payload),
  cancelInterview: (id: string) => api.post<Interview>(`/recruitment/interviews/${id}/cancel`),
  completeInterview: (id: string) => api.post<Interview>(`/recruitment/interviews/${id}/complete`),
  markInterviewNoShow: (id: string) => api.post<Interview>(`/recruitment/interviews/${id}/no-show`),
  myInterviews: () => api.get<Interview[]>('/recruitment/interviews/mine'),
  getFeedback: (interviewId: string) =>
    api.get<InterviewFeedbackList>(`/recruitment/interviews/${interviewId}/feedback`),
  submitFeedback: (interviewId: string, payload: FeedbackPayload) =>
    api.post<InterviewFeedback>(`/recruitment/interviews/${interviewId}/feedback`, payload),

  // D2 — offers (approve / reject: workflowApi.approve('OFFER', id) in api-workflow.ts)
  listOffers: (params?: { status?: JobOfferStatus }) =>
    api.get<Offer[]>('/recruitment/offers', { params }),
  getOffer: (id: string) => api.get<Offer>(`/recruitment/offers/${id}`),
  createOffer: (applicationId: string, payload: OfferPayload) =>
    api.post<Offer>(`/recruitment/applications/${applicationId}/offers`, payload),
  updateOffer: (id: string, payload: Partial<OfferPayload>) =>
    api.patch<Offer>(`/recruitment/offers/${id}`, payload),
  submitOffer: (id: string) => api.post<Offer>(`/recruitment/offers/${id}/submit`),
  sendOffer: (id: string) => api.post<Offer>(`/recruitment/offers/${id}/send`),
  withdrawOffer: (id: string) => api.post<Offer>(`/recruitment/offers/${id}/withdraw`),
  convertOffer: (id: string, payload: OfferConversionPayload) =>
    api.post<OfferConversionResult>(`/recruitment/offers/${id}/convert`, payload),
  offerPdf: (id: string) =>
    api.get<Blob>(`/recruitment/offers/${id}/pdf`, { responseType: 'blob' }),

  // D3 — settings, pre-onboarding, reports
  getSettings: () => api.get<RecruitmentSettings>('/recruitment/settings'),
  updateSettings: (payload: Partial<Omit<RecruitmentSettings, 'careersUrl'>>) =>
    api.put<RecruitmentSettings>('/recruitment/settings', payload),
  listPreOnboarding: (params?: { status?: PreOnboardingStatus }) =>
    api.get<PreOnboardingInvite[]>('/recruitment/pre-onboarding', { params }),
  getPreOnboarding: (id: string) =>
    api.get<PreOnboardingInvite>(`/recruitment/pre-onboarding/${id}`),
  createPreOnboarding: (payload: PreOnboardingInvitePayload) =>
    api.post<PreOnboardingInviteCreated>('/recruitment/pre-onboarding', payload),
  revokePreOnboarding: (id: string) =>
    api.post<PreOnboardingInvite>(`/recruitment/pre-onboarding/${id}/revoke`),
  resendPreOnboarding: (id: string) =>
    api.post<PreOnboardingInviteCreated>(`/recruitment/pre-onboarding/${id}/resend`),
  completePreOnboarding: (id: string) =>
    api.post<PreOnboardingInvite>(`/recruitment/pre-onboarding/${id}/complete`),
  funnel: (params?: { jobOpeningId?: string; from?: string; to?: string }) =>
    api.get<FunnelReport>('/recruitment/reports/funnel', { params }),
};
