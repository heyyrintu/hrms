import { api } from '@/lib/api';

export type SurveyStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
export type EngagementAudience = 'ALL' | 'DEPARTMENT' | 'BRANCH';
export type SurveyQuestionType = 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'RATING' | 'ENPS';

export interface SurveyQuestion {
  id: string;
  order: number;
  type: SurveyQuestionType;
  text: string;
  required: boolean;
  options: string[];
}

export interface Survey {
  id: string;
  title: string;
  description?: string | null;
  isAnonymous: boolean;
  status: SurveyStatus;
  audienceType: EngagementAudience;
  audienceIds: string[];
  closesAt?: string | null;
  launchedAt?: string | null;
  closedAt?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  questions: SurveyQuestion[];
}

export interface MySurvey {
  id: string;
  title: string;
  description?: string | null;
  isAnonymous: boolean;
  status: SurveyStatus;
  closesAt?: string | null;
  launchedAt?: string | null;
  questionCount: number;
  submitted: boolean;
  isOpen: boolean;
}

export interface SurveyForm extends Survey {
  submitted: boolean;
}

export interface SurveyQuestionInput {
  type: SurveyQuestionType;
  text: string;
  required?: boolean;
  options?: string[];
}

export interface CreateSurveyPayload {
  title: string;
  description?: string;
  isAnonymous?: boolean;
  audienceType: EngagementAudience;
  audienceIds: string[];
  closesAt?: string;
  questions: SurveyQuestionInput[];
}

export type UpdateSurveyPayload = Partial<CreateSurveyPayload>;

export interface AnswerInput {
  questionId: string;
  text?: string;
  choices?: string[];
  value?: number;
}

export interface SubmitSurveyPayload {
  answers: AnswerInput[];
}

export interface ListSurveysParams {
  status?: SurveyStatus;
  page?: number;
  limit?: number;
}

export type QuestionResult =
  | {
      questionId: string;
      text: string;
      type: 'SINGLE_CHOICE' | 'MULTI_CHOICE';
      options: { option: string; count: number }[];
    }
  | {
      questionId: string;
      text: string;
      type: 'RATING';
      average: number | null;
      distribution: Record<number, number>;
    }
  | {
      questionId: string;
      text: string;
      type: 'ENPS';
      promoters: number;
      passives: number;
      detractors: number;
      score: number | null;
      distribution: Record<number, number>;
    }
  | {
      questionId: string;
      text: string;
      type: 'TEXT';
      answers: string[];
    };

export interface SurveyResults {
  surveyId: string;
  isAnonymous: boolean;
  withheld: boolean;
  participantCount: number;
  responseCount: number;
  responseRate: number;
  questions?: QuestionResult[];
}

export interface NamedResponse {
  id: string;
  submittedAt: string | null;
  employee: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
  answers: {
    id: string;
    questionId: string;
    textValue: string | null;
    choiceValues: string[];
    numericValue: number | null;
  }[];
}

/**
 * Pulse surveys, including anonymous responses.
 *
 * Lives beside `@/lib/api` so the surveys workstream owns its own client
 * surface; every call still goes through the shared axios instance and
 * therefore the shared auth interceptor.
 */
export const surveysApi = {
  /** HR/SUPER: paginated list, optional status filter. */
  list: (params?: ListSurveysParams) => api.get('/engagement/surveys', { params }),

  /** HR/SUPER: create a draft survey with its questions. */
  create: (data: CreateSurveyPayload) => api.post('/engagement/surveys', data),

  /** All roles: surveys I am a participant in. */
  mine: () => api.get('/engagement/surveys/mine'),

  /** HR/SUPER: one survey, for editing. */
  get: (id: string) => api.get(`/engagement/surveys/${id}`),

  /** HR/SUPER: update a draft survey. */
  update: (id: string, data: UpdateSurveyPayload) => api.put(`/engagement/surveys/${id}`, data),

  /** HR/SUPER: delete a draft survey. */
  remove: (id: string) => api.delete(`/engagement/surveys/${id}`),

  /** HR/SUPER: DRAFT -> ACTIVE. */
  launch: (id: string) => api.post(`/engagement/surveys/${id}/launch`),

  /** HR/SUPER: ACTIVE -> CLOSED. */
  close: (id: string) => api.post(`/engagement/surveys/${id}/close`),

  /** All roles: the survey and its questions, for a participant to respond to. */
  form: (id: string) => api.get(`/engagement/surveys/${id}/form`),

  /** All roles: submit my response. */
  submit: (id: string, data: SubmitSurveyPayload) =>
    api.post(`/engagement/surveys/${id}/responses`, data),

  /** HR/SUPER: aggregated results. */
  results: (id: string) => api.get(`/engagement/surveys/${id}/results`),

  /** HR/SUPER: named responses (non-anonymous surveys only). */
  responses: (id: string) => api.get(`/engagement/surveys/${id}/responses`),
};
