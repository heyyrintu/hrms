import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CareersPage from './page';
import { careersApi } from '@/lib/api-careers';

jest.mock('next/navigation', () => ({
  useParams: () => ({ tenantCode: 'acme' }),
}));

jest.mock('@/lib/api-careers', () => {
  const actual = jest.requireActual('@/lib/api-careers');
  return { ...actual, careersApi: { getCareers: jest.fn(), getJob: jest.fn(), apply: jest.fn() } };
});

const mockApi = careersApi as jest.Mocked<typeof careersApi>;

const careers = (overrides: Record<string, unknown> = {}) => ({
  company: { name: 'Acme Inc', logoUrl: 'https://cdn.example/logo.png', website: 'https://acme.example', description: null, careersIntro: 'We build things.' },
  jobs: [
    {
      slug: 'swe-1',
      title: 'Software Engineer',
      location: 'Remote',
      department: 'Engineering',
      employmentType: 'PERMANENT',
      experienceMin: 1,
      experienceMax: 3,
      publishedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  ...overrides,
});

const httpError = (status: number) => Object.assign(new Error('fail'), { response: { status } });

describe('CareersPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists open jobs and links to the job page', async () => {
    mockApi.getCareers.mockResolvedValue({ data: careers() } as any);
    render(<CareersPage />);

    expect(await screen.findByText('Acme Inc')).toBeInTheDocument();
    expect(mockApi.getCareers).toHaveBeenCalledWith('acme');
    const link = screen.getByText('Software Engineer').closest('a');
    expect(link).toHaveAttribute('href', '/careers/acme/jobs/swe-1');
    expect(screen.getByText('We build things.')).toBeInTheDocument();
  });

  it('shows an empty state with no open jobs', async () => {
    mockApi.getCareers.mockResolvedValue({ data: careers({ jobs: [] }) } as any);
    render(<CareersPage />);
    expect(await screen.findByText(/No open positions/)).toBeInTheDocument();
  });

  it('shows "Careers page not found" on 404, not a generic error', async () => {
    mockApi.getCareers.mockRejectedValue(httpError(404));
    render(<CareersPage />);
    expect(await screen.findByText('Careers page not found')).toBeInTheDocument();
  });

  it('offers a retry on a network error', async () => {
    mockApi.getCareers.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce({ data: careers() } as any);
    render(<CareersPage />);
    fireEvent.click(await screen.findByText('Try again'));
    expect(await screen.findByText('Acme Inc')).toBeInTheDocument();
  });
});
