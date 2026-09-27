import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecruitmentReportsPage from './page';
import { recruitmentApi } from '@/lib/api-recruitment';
import { useAuth } from '@/contexts/AuthContext';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api-recruitment', () => ({
  recruitmentApi: { listOpenings: jest.fn(), funnel: jest.fn() },
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: jest.fn() }));

const mockApi = recruitmentApi as jest.Mocked<typeof recruitmentApi>;
const mockUseAuth = useAuth as jest.Mock;

const report = (overrides: Record<string, unknown> = {}) => ({
  jobOpeningId: null,
  from: null,
  to: null,
  stages: [
    { stageId: 'applied', name: 'Applied', category: 'APPLIED', reached: 10, current: 4, conversionFromPrevious: null, avgDaysInStage: 1 },
    { stageId: 'interview', name: 'Interview', category: 'INTERVIEW', reached: 5, current: 2, conversionFromPrevious: 50, avgDaysInStage: null },
  ],
  totals: {
    applied: 10,
    hired: 2,
    rejected: 3,
    withdrawn: 1,
    offersSent: 3,
    offersAccepted: 2,
    offersDeclined: 1,
    offerAcceptanceRate: 66.7,
    avgTimeToHireDays: 12.5,
  },
  bySource: [{ source: 'CAREERS_PAGE', count: 7 }, { source: 'REFERRAL', count: 3 }],
  ...overrides,
});

describe('RecruitmentReportsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ hasRole: (...roles: string[]) => roles.includes('HR_ADMIN') });
    mockApi.listOpenings.mockResolvedValue({ data: [{ id: 'opening-1', title: 'SWE' }] } as any);
  });

  it('loads openings and the funnel report for HR with no filters', async () => {
    mockApi.funnel.mockResolvedValue({ data: report() } as any);
    render(<RecruitmentReportsPage />);

    expect((await screen.findAllByText('Applied')).length).toBeGreaterThan(0);
    expect(mockApi.funnel).toHaveBeenCalledWith({ jobOpeningId: undefined, from: undefined, to: undefined });
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('CAREERS_PAGE')).toBeInTheDocument();
  });

  it('shows the offer acceptance rate and avg time to hire totals', async () => {
    mockApi.funnel.mockResolvedValue({ data: report() } as any);
    render(<RecruitmentReportsPage />);
    expect(await screen.findByText('67%')).toBeInTheDocument();
    expect(screen.getByText('12.5d')).toBeInTheDocument();
  });

  it('requires a job opening for a plain manager and does not call funnel without one', async () => {
    mockUseAuth.mockReturnValue({ hasRole: (...roles: string[]) => roles.includes('MANAGER') });
    render(<RecruitmentReportsPage />);
    expect(await screen.findByText(/Choose one of your job openings/)).toBeInTheDocument();
    expect(mockApi.funnel).not.toHaveBeenCalled();
  });

  it('runs the report for a manager once an opening is chosen', async () => {
    mockUseAuth.mockReturnValue({ hasRole: (...roles: string[]) => roles.includes('MANAGER') });
    mockApi.funnel.mockResolvedValue({ data: report({ jobOpeningId: 'opening-1' }) } as any);
    render(<RecruitmentReportsPage />);
    await screen.findByText(/Choose one of your job openings/);

    fireEvent.change(screen.getByLabelText('Job opening (required)'), { target: { value: 'opening-1' } });

    await waitFor(() =>
      expect(mockApi.funnel).toHaveBeenCalledWith({ jobOpeningId: 'opening-1', from: undefined, to: undefined }),
    );
    expect((await screen.findAllByText('Applied')).length).toBeGreaterThan(0);
  });
});
