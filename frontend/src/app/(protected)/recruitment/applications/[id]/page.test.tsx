import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import ApplicationDetailPage from './page';
import { recruitmentApi } from '@/lib/api-recruitment';
import { employeesApi, lettersApi, onboardingApi } from '@/lib/api';
import { UserRole } from '@/types';

jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
      },
    },
  ),
);

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'app-1' }),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

let mockUser: { id: string; role: UserRole; employeeId?: string } = {
  id: 'u-hr',
  role: UserRole.HR_ADMIN,
  employeeId: 'emp-hr',
};
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    hasRole: (...roles: string[]) => roles.includes(mockUser.role),
  }),
}));

jest.mock('@/lib/api-recruitment', () => {
  const actual = jest.requireActual('@/lib/api-recruitment');
  return {
    ...actual,
    recruitmentApi: {
      getApplication: jest.fn(),
      listInterviews: jest.fn(),
      scheduleInterview: jest.fn(),
      updateInterview: jest.fn(),
      cancelInterview: jest.fn(),
      completeInterview: jest.fn(),
      markInterviewNoShow: jest.fn(),
      getFeedback: jest.fn(),
      submitFeedback: jest.fn(),
      listOffers: jest.fn(),
      createOffer: jest.fn(),
      updateOffer: jest.fn(),
      submitOffer: jest.fn(),
      sendOffer: jest.fn(),
      withdrawOffer: jest.fn(),
      convertOffer: jest.fn(),
      offerPdf: jest.fn(),
    },
  };
});

jest.mock('@/lib/api', () => ({
  employeesApi: { getAll: jest.fn() },
  lettersApi: { getTemplates: jest.fn() },
  designationsApi: { getAll: jest.fn() },
  departmentsApi: { getAll: jest.fn() },
  branchesApi: { getAll: jest.fn() },
  payrollApi: { getStructures: jest.fn() },
  onboardingApi: { getTemplates: jest.fn() },
}));

const api = recruitmentApi as jest.Mocked<typeof recruitmentApi>;

const application = (overrides: Record<string, unknown> = {}) => ({
  id: 'app-1',
  candidate: {
    id: 'cand-1',
    firstName: 'Asha',
    lastName: 'Rao',
    email: 'asha@example.com',
    phone: '+91 90000 00000',
    currentCompany: 'Globex',
    currentTitle: 'Engineer',
    totalExperienceYears: 4,
    currentCtc: 900000,
    expectedCtc: 1300000,
    noticePeriodDays: 30,
    location: 'Pune',
    linkedinUrl: null,
    source: 'REFERRAL',
    referredBy: null,
    resumeKey: null,
    resumeFileName: 'asha.pdf',
    notes: null,
    createdAt: '2026-03-01T12:00:00.000Z',
  },
  jobOpening: { id: 'open-1', title: 'Backend Engineer', hiringManagerId: 'emp-mgr', requisitionId: null },
  stage: { id: 'st-int', name: 'Interview', sortOrder: 2, category: 'INTERVIEW', isActive: true },
  status: 'ACTIVE',
  source: 'REFERRAL',
  resumeKey: null,
  resumeFileName: 'asha.pdf',
  coverLetter: null,
  rejectionReason: null,
  appliedAt: '2026-03-01T12:00:00.000Z',
  stageChangedAt: '2026-03-05T12:00:00.000Z',
  hiredAt: null,
  history: [
    {
      id: 'ev-1',
      fromStage: { id: 'st-app', name: 'Applied' },
      toStage: { id: 'st-int', name: 'Interview' },
      movedBy: { userId: 'u-hr', name: 'Hema' },
      note: 'Strong CV',
      createdAt: '2026-03-05T12:00:00.000Z',
    },
  ],
  ...overrides,
});

const offer = (overrides: Record<string, unknown> = {}) => ({
  id: 'off-1',
  applicationId: 'app-1',
  candidate: { id: 'cand-1', firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' },
  jobOpening: { id: 'open-1', title: 'Backend Engineer' },
  template: { id: 'tpl-1', name: 'Standard offer' },
  content: '<p>Dear Asha</p>',
  designation: { id: 'des-1', name: 'Engineer II' },
  department: null,
  branch: null,
  reportingManager: null,
  employmentType: 'PERMANENT',
  annualCtc: 1200000,
  monthlyBasePay: null,
  salaryStructure: null,
  joiningDate: '2026-04-01',
  expiresAt: null,
  status: 'DRAFT',
  sentAt: null,
  respondedAt: null,
  acceptedName: null,
  declineReason: null,
  decisionNote: null,
  employeeId: null,
  convertedAt: null,
  createdAt: '2026-03-10T12:00:00.000Z',
  ...overrides,
});

describe('ApplicationDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 'u-hr', role: UserRole.HR_ADMIN, employeeId: 'emp-hr' };
    api.getApplication.mockResolvedValue({ data: application() } as any);
    api.listInterviews.mockResolvedValue({ data: [] } as any);
    api.listOffers.mockResolvedValue({ data: [] } as any);
    (employeesApi.getAll as jest.Mock).mockResolvedValue({
      data: { data: [{ id: 'emp-p1', employeeCode: 'E1', firstName: 'Pan', lastName: 'One' }] },
    });
    (lettersApi.getTemplates as jest.Mock).mockResolvedValue({
      data: [{ id: 'tpl-1', name: 'Standard offer', type: 'OFFER_LETTER', isActive: true }],
    });
    (onboardingApi.getTemplates as jest.Mock).mockResolvedValue({ data: [{ id: 'onb-1', name: 'Engineering' }] });
    const { designationsApi, departmentsApi, branchesApi, payrollApi } = jest.requireMock('@/lib/api');
    designationsApi.getAll.mockResolvedValue({ data: [] });
    departmentsApi.getAll.mockResolvedValue({ data: [] });
    branchesApi.getAll.mockResolvedValue({ data: [] });
    payrollApi.getStructures.mockResolvedValue({ data: [] });
  });

  it('shows the candidate, stage history, CTC and the offers section to HR', async () => {
    render(<ApplicationDetailPage />);

    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(api.getApplication).toHaveBeenCalledWith('app-1');
    expect(screen.getByText('Applied → Interview')).toBeInTheDocument();
    expect(screen.getByText('₹9,00,000')).toBeInTheDocument();
    expect(await screen.findByText('Offers')).toBeInTheDocument();
    expect(await screen.findByText('Draft offer')).toBeInTheDocument();
    expect(screen.getByText('Schedule interview')).toBeInTheDocument();
  });

  it('lets the hiring manager schedule interviews but hides offers and CTC', async () => {
    mockUser = { id: 'u-mgr', role: UserRole.MANAGER, employeeId: 'emp-mgr' };
    render(<ApplicationDetailPage />);

    expect(await screen.findByText('Schedule interview')).toBeInTheDocument();
    expect(screen.queryByText('Offers')).not.toBeInTheDocument();
    expect(screen.queryByText('₹9,00,000')).not.toBeInTheDocument();
    expect(api.listOffers).not.toHaveBeenCalled();
  });

  it('does not offer scheduling to a manager who is not the hiring manager', async () => {
    mockUser = { id: 'u-m2', role: UserRole.MANAGER, employeeId: 'emp-other' };
    render(<ApplicationDetailPage />);
    await screen.findByRole('heading', { name: 'Asha Rao' });
    await waitFor(() => expect(api.listInterviews).toHaveBeenCalled());
    expect(screen.queryByText('Schedule interview')).not.toBeInTheDocument();
  });

  it('blocks employees without calling the API', () => {
    mockUser = { id: 'u-e', role: UserRole.EMPLOYEE, employeeId: 'emp-e' };
    render(<ApplicationDetailPage />);
    expect(screen.getByText('You do not have access to recruitment.')).toBeInTheDocument();
    expect(api.getApplication).not.toHaveBeenCalled();
  });

  it('shows not-found for a 404', async () => {
    api.getApplication.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 404 } }));
    render(<ApplicationDetailPage />);
    expect(await screen.findByText('Application not found')).toBeInTheDocument();
  });

  it('schedules an interview with a picked panel', async () => {
    api.scheduleInterview.mockResolvedValue({ data: { id: 'int-1' } } as any);
    render(<ApplicationDetailPage />);

    fireEvent.click(await screen.findByText('Schedule interview'));
    fireEvent.change(screen.getByLabelText('Round'), { target: { value: 'Technical' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-20' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Pan One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    await waitFor(() => expect(api.scheduleInterview).toHaveBeenCalled());
    const [appId, payload] = api.scheduleInterview.mock.calls[0];
    expect(appId).toBe('app-1');
    expect(payload).toMatchObject({ roundName: 'Technical', mode: 'VIDEO', panelEmployeeIds: ['emp-p1'] });
    expect(new Date(payload.scheduledEnd).getTime()).toBeGreaterThan(new Date(payload.scheduledStart).getTime());
  });

  it('drafts an offer from a template', async () => {
    api.createOffer.mockResolvedValue({ data: offer() } as any);
    render(<ApplicationDetailPage />);

    fireEvent.click(await screen.findByText('Draft offer'));
    await screen.findByRole('option', { name: 'Standard offer' });
    fireEvent.change(screen.getByLabelText('Offer-letter template'), { target: { value: 'tpl-1' } });
    fireEvent.change(screen.getByLabelText('Annual CTC (₹)'), { target: { value: '1200000' } });
    fireEvent.change(screen.getByLabelText('Joining date'), { target: { value: '2026-04-01' } });
    fireEvent.click(screen.getByText('Save draft'));

    await waitFor(() => expect(api.createOffer).toHaveBeenCalled());
    expect(api.createOffer.mock.calls[0][0]).toBe('app-1');
    expect(api.createOffer.mock.calls[0][1]).toMatchObject({
      templateId: 'tpl-1',
      annualCtc: 1200000,
      joiningDate: '2026-04-01',
      employmentType: 'PERMANENT',
      expiresAt: null,
    });
  });

  it('submits a draft offer and shows its timeline', async () => {
    api.listOffers.mockResolvedValue({ data: [offer()] } as any);
    api.submitOffer.mockResolvedValue({ data: offer({ status: 'PENDING_APPROVAL' }) } as any);
    render(<ApplicationDetailPage />);

    const card = await screen.findByTestId('offer-off-1');
    expect(within(card).getByText('Drafted')).toBeInTheDocument();
    expect(screen.queryByText('Draft offer')).not.toBeInTheDocument();
    fireEvent.click(within(card).getByText('Submit for approval'));
    await waitFor(() => expect(api.submitOffer).toHaveBeenCalledWith('off-1'));
  });

  it('converts an accepted offer', async () => {
    api.listOffers.mockResolvedValue({
      data: [offer({ status: 'ACCEPTED', sentAt: '2026-03-12T12:00:00.000Z', respondedAt: '2026-03-13T12:00:00.000Z', acceptedName: 'Asha Rao' })],
    } as any);
    api.convertOffer.mockResolvedValue({
      data: { employeeId: 'emp-new', onboardingProcessId: 'proc-1', employeeSalaryId: null },
    } as any);
    render(<ApplicationDetailPage />);

    const card = await screen.findByTestId('offer-off-1');
    expect(within(card).getByText('Signed as “Asha Rao”')).toBeInTheDocument();
    fireEvent.click(within(card).getByText('Convert to employee'));
    fireEvent.change(await screen.findByLabelText('Employee code'), { target: { value: 'EMP-101' } });
    fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'welcome-123' } });
    await screen.findByRole('option', { name: 'Engineering' });
    fireEvent.change(screen.getByLabelText('Onboarding template (optional)'), { target: { value: 'onb-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));

    await waitFor(() =>
      expect(api.convertOffer).toHaveBeenCalledWith('off-1', {
        employeeCode: 'EMP-101',
        createUser: true,
        userEmail: 'asha@example.com',
        userPassword: 'welcome-123',
        onboardingTemplateId: 'onb-1',
      }),
    );
  });
});
