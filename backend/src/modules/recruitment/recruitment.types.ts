import {
  CandidateSource,
  DocumentCategory,
  EmploymentType,
  InterviewMode,
  InterviewRecommendation,
  InterviewStatus,
  JobApplicationStatus,
  JobOfferStatus,
  JobOpeningStatus,
  JobRequisitionStatus,
  PipelineStageCategory,
  PreOnboardingStatus,
  Prisma,
} from '@prisma/client';

/**
 * Shared contract of the hiring module (Keka wave D). Frozen scaffold file,
 * mirrored in frontend/src/lib/api-recruitment.ts and api-careers.ts.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part D.
 *
 * Dates are ISO strings; `@db.Date` columns are YYYY-MM-DD. Money is `number`.
 */

// ---- Shared refs ------------------------------------------------------------

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

// ---- D1: requisitions, openings, stages, candidates, applications -----------

export interface RequisitionView {
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

export interface JobOpeningView {
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
  /** ACTIVE applications per stage id. */
  applicationCounts: Record<string, number>;
  createdAt: string;
}

export interface PipelineStageView {
  id: string;
  name: string;
  sortOrder: number;
  category: PipelineStageCategory;
  isActive: boolean;
}

export interface CandidateView {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  totalExperienceYears: number | null;
  /** HR_ADMIN / SUPER_ADMIN only; null for other roles. */
  currentCtc: number | null;
  /** HR_ADMIN / SUPER_ADMIN only; null for other roles. */
  expectedCtc: number | null;
  noticePeriodDays: number | null;
  location: string | null;
  linkedinUrl: string | null;
  source: CandidateSource;
  referredBy: EmployeeSummary | null;
  /** Upload key; download through the authenticated uploads endpoint. */
  resumeKey: string | null;
  resumeFileName: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CandidateDetailView extends CandidateView {
  applications: ApplicationSummary[];
}

export interface ApplicationSummary {
  id: string;
  jobOpening: { id: string; title: string };
  stage: PipelineStageView;
  status: JobApplicationStatus;
  appliedAt: string;
}

export interface ApplicationCardView {
  id: string;
  candidate: { id: string; firstName: string; lastName: string; email: string; currentTitle: string | null };
  stage: PipelineStageView;
  status: JobApplicationStatus;
  source: CandidateSource;
  appliedAt: string;
  stageChangedAt: string;
  /** Interviews scheduled and not cancelled. */
  interviewCount: number;
}

export interface StageEventView {
  id: string;
  fromStage: { id: string; name: string } | null;
  toStage: { id: string; name: string };
  movedBy: { userId: string; name: string } | null;
  note: string | null;
  createdAt: string;
}

export interface ApplicationDetailView {
  id: string;
  candidate: CandidateView;
  jobOpening: { id: string; title: string; hiringManagerId: string | null; requisitionId: string | null };
  stage: PipelineStageView;
  status: JobApplicationStatus;
  source: CandidateSource;
  resumeKey: string | null;
  resumeFileName: string | null;
  coverLetter: string | null;
  rejectionReason: string | null;
  appliedAt: string;
  stageChangedAt: string;
  hiredAt: string | null;
  history: StageEventView[];
}

/** ApplicationsService.moveToStage — consumed by D2 (offers, conversion). */
export interface MoveApplicationInput {
  tenantId: string;
  applicationId: string;
  /** Exactly one of toStageId / toCategory. toCategory = the first active stage of it. */
  toStageId?: string;
  toCategory?: PipelineStageCategory;
  /** Null for system moves. */
  actorUserId: string | null;
  note?: string | null;
  /** Required reason when the target is a REJECTED-category stage. */
  rejectionReason?: string | null;
  tx?: Prisma.TransactionClient;
}

/** CandidatesService.findOrCreateForCareers — consumed by D3. */
export interface CareersCandidateInput {
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  totalExperienceYears?: number | null;
  linkedinUrl?: string | null;
  /** Set on the candidate only when it has none yet. */
  resumeUploadId?: string | null;
}

/** ApplicationsService.createFromCareers — consumed by D3. */
export interface CareersApplicationInput {
  tenantId: string;
  jobOpeningId: string;
  candidateId: string;
  resumeUploadId: string | null;
  coverLetter?: string | null;
}

export interface CareersApplicationResult {
  /** False when the candidate had already applied to this opening. */
  created: boolean;
  applicationId: string;
}

// ---- D2: interviews, feedback, offers ---------------------------------------

export interface InterviewView {
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
  /** Panelist employee ids that have submitted feedback. */
  feedbackSubmittedBy: string[];
  /** For the viewer: is a panelist and has not submitted feedback yet. */
  myFeedbackDue: boolean;
}

export interface FeedbackScore {
  criterion: string;
  rating: number;
  comment?: string | null;
}

export interface InterviewFeedbackView {
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

export interface InterviewFeedbackListView {
  /** False when the viewer is a panelist who has not submitted yet (others hidden). */
  visible: boolean;
  items: InterviewFeedbackView[];
}

export interface OfferView {
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
  /** YYYY-MM-DD */
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

export interface OfferConversionResult {
  employeeId: string;
  onboardingProcessId: string | null;
  employeeSalaryId: string | null;
}

/** GET /public/offers/:token */
export interface PublicOfferView {
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

// ---- D3: settings, careers, pre-onboarding, funnel --------------------------

export interface PreOnboardingDocumentDefinition {
  /** /^[a-z0-9_]{1,50}$/ */
  key: string;
  label: string;
  category: DocumentCategory;
  required: boolean;
}

export interface RecruitmentSettingsView {
  careersPageEnabled: boolean;
  careersIntro: string | null;
  offerExpiryDays: number;
  preOnboardingExpiryDays: number;
  preOnboardingDocuments: PreOnboardingDocumentDefinition[];
  /** `${FRONTEND_URL}/careers/<tenant code>` */
  careersUrl: string;
}

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

export interface PublicCareersView {
  company: {
    name: string;
    logoUrl: string | null;
    website: string | null;
    description: string | null;
    careersIntro: string | null;
  };
  jobs: PublicJobSummary[];
}

export interface PublicJobView extends PublicJobSummary {
  description: string;
  requirements: string | null;
  /** Only when the opening shows salary. */
  salaryMin: number | null;
  salaryMax: number | null;
  company: { name: string; logoUrl: string | null };
}

export interface PreOnboardingDocumentState extends PreOnboardingDocumentDefinition {
  uploaded: boolean;
  fileName: string | null;
  uploadedAt: string | null;
  /** HR verified the EmployeeDocument. */
  verified: boolean;
}

export interface PreOnboardingInviteView {
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
  invite: PreOnboardingInviteView;
  /** Returned once; only the hash is stored. */
  link: string;
}

/** The only fields the public portal may write (no bank / PAN / Aadhaar / UAN). */
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

/** GET /public/pre-onboarding/:token */
export interface PublicPreOnboardingView {
  company: { name: string; logoUrl: string | null };
  employeeFirstName: string;
  joinDate: string;
  status: PreOnboardingStatus;
  expiresAt: string;
  documents: Array<Omit<PreOnboardingDocumentState, 'verified' | 'category'>>;
  personalDetails: PreOnboardingPersonalDetails | null;
}

export interface FunnelStageRow {
  stageId: string;
  name: string;
  category: PipelineStageCategory;
  reached: number;
  current: number;
  /** Percent of the previous stage's `reached`; null for the first stage. */
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
    /** Percent of answered offers accepted; null when none answered. */
    offerAcceptanceRate: number | null;
    avgTimeToHireDays: number | null;
  };
  bySource: Array<{ source: CandidateSource; count: number }>;
}

/** Built-in stages created by PipelineStagesService.ensureDefaults. */
export const DEFAULT_PIPELINE_STAGES: ReadonlyArray<{
  name: string;
  category: PipelineStageCategory;
}> = [
  { name: 'Applied', category: 'APPLIED' },
  { name: 'Screening', category: 'SCREENING' },
  { name: 'Interview', category: 'INTERVIEW' },
  { name: 'Offer', category: 'OFFER' },
  { name: 'Hired', category: 'HIRED' },
  { name: 'Rejected', category: 'REJECTED' },
];

/** Default pre-onboarding checklist when the tenant has configured none. */
export const DEFAULT_PRE_ONBOARDING_DOCUMENTS: ReadonlyArray<PreOnboardingDocumentDefinition> = [
  { key: 'photo_id', label: 'Government photo ID', category: 'ID_PROOF', required: true },
  { key: 'address_proof', label: 'Address proof', category: 'ADDRESS_PROOF', required: true },
  { key: 'education', label: 'Highest education certificate', category: 'EDUCATION', required: true },
  { key: 'relieving_letter', label: 'Relieving letter from last employer', category: 'EMPLOYMENT', required: false },
  { key: 'photo', label: 'Passport-size photograph', category: 'OTHER', required: false },
];
