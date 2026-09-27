import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CareersJobPage from './page';
import { careersApi } from '@/lib/api-careers';

jest.mock('next/navigation', () => ({
  useParams: () => ({ tenantCode: 'acme', slug: 'swe-1' }),
}));

jest.mock('@/lib/api-careers', () => {
  const actual = jest.requireActual('@/lib/api-careers');
  return { ...actual, careersApi: { getCareers: jest.fn(), getJob: jest.fn(), apply: jest.fn() } };
});

const mockApi = careersApi as jest.Mocked<typeof careersApi>;

const job = (overrides: Record<string, unknown> = {}) => ({
  slug: 'swe-1',
  title: 'Software Engineer',
  location: 'Remote',
  department: 'Engineering',
  employmentType: 'PERMANENT',
  experienceMin: 1,
  experienceMax: 3,
  publishedAt: '2026-01-01T00:00:00.000Z',
  description: 'Build great software.',
  requirements: null,
  salaryMin: null,
  salaryMax: null,
  company: { name: 'Acme Inc', logoUrl: null },
  ...overrides,
});

const httpError = (status: number, message?: string) =>
  Object.assign(new Error('fail'), { response: { status, data: { message } } });

const pdfFile = () => new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' });

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Asha' } });
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Rao' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'asha@example.com' } });
  fireEvent.change(screen.getByLabelText(/Resume/), { target: { files: [pdfFile()] } });
}

describe('CareersJobPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows job details and the apply form', async () => {
    mockApi.getJob.mockResolvedValue({ data: job() } as any);
    render(<CareersJobPage />);
    expect(await screen.findByText('Software Engineer')).toBeInTheDocument();
    expect(mockApi.getJob).toHaveBeenCalledWith('acme', 'swe-1');
    expect(screen.getByText('Build great software.')).toBeInTheDocument();
    expect(screen.getByText('Apply for this role')).toBeInTheDocument();
  });

  it('shows "Careers page not found" on 404', async () => {
    mockApi.getJob.mockRejectedValue(httpError(404));
    render(<CareersJobPage />);
    expect(await screen.findByText('Careers page not found')).toBeInTheDocument();
  });

  it('rejects an oversized resume client-side without calling apply', async () => {
    mockApi.getJob.mockResolvedValue({ data: job() } as any);
    render(<CareersJobPage />);
    await screen.findByText('Apply for this role');

    const bigFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Resume/), { target: { files: [bigFile] } });
    expect(await screen.findByText('Resume must be 5 MB or smaller')).toBeInTheDocument();
    expect(mockApi.apply).not.toHaveBeenCalled();
  });

  it('rejects a non-resume file type client-side', async () => {
    mockApi.getJob.mockResolvedValue({ data: job() } as any);
    render(<CareersJobPage />);
    await screen.findByText('Apply for this role');

    const exe = new File(['MZ'], 'virus.exe', { type: 'application/x-msdownload' });
    fireEvent.change(screen.getByLabelText(/Resume/), { target: { files: [exe] } });
    expect(await screen.findByText('Resume must be a PDF, DOC or DOCX file')).toBeInTheDocument();
  });

  it('submits the application and shows the success state', async () => {
    mockApi.getJob.mockResolvedValue({ data: job() } as any);
    mockApi.apply.mockResolvedValue({ data: { message: 'Application received' } } as any);
    render(<CareersJobPage />);
    await screen.findByText('Apply for this role');

    fillRequiredFields();
    fireEvent.click(screen.getByText('Submit application'));

    await waitFor(() =>
      expect(mockApi.apply).toHaveBeenCalledWith(
        'acme',
        'swe-1',
        expect.objectContaining({ firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', website: '' }),
        expect.any(File),
      ),
    );
    expect(await screen.findByText('Application received')).toBeInTheDocument();
  });

  it('shows the same success message even when the server reports a duplicate (no existence leak)', async () => {
    mockApi.getJob.mockResolvedValue({ data: job() } as any);
    mockApi.apply.mockResolvedValue({ data: { message: 'Application received' } } as any);
    render(<CareersJobPage />);
    await screen.findByText('Apply for this role');
    fillRequiredFields();
    fireEvent.click(screen.getByText('Submit application'));
    expect(await screen.findByText('Application received')).toBeInTheDocument();
  });

  it('shows a server error message on failure', async () => {
    mockApi.getJob.mockResolvedValue({ data: job() } as any);
    mockApi.apply.mockRejectedValue(httpError(400, 'Resume must be one of: application/pdf'));
    render(<CareersJobPage />);
    await screen.findByText('Apply for this role');
    fillRequiredFields();
    fireEvent.click(screen.getByText('Submit application'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resume must be one of');
  });

  it('keeps the honeypot field out of the visible tab order', async () => {
    mockApi.getJob.mockResolvedValue({ data: job() } as any);
    render(<CareersJobPage />);
    await screen.findByText('Apply for this role');
    const honeypot = screen.getByLabelText('Website');
    expect(honeypot).toHaveAttribute('tabIndex', '-1');
  });
});
