import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OffersPage from './page';
import { recruitmentApi } from '@/lib/api-recruitment';

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

const mockHasRole = jest.fn();
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', employeeId: 'emp-hr' }, hasRole: mockHasRole }),
}));

jest.mock('@/lib/api-recruitment', () => {
  const actual = jest.requireActual('@/lib/api-recruitment');
  return { ...actual, recruitmentApi: { listOffers: jest.fn() } };
});

const mockApi = recruitmentApi as jest.Mocked<typeof recruitmentApi>;

const offer = {
  id: 'off-1',
  applicationId: 'app-1',
  candidate: { id: 'c1', firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' },
  jobOpening: { id: 'o1', title: 'Backend Engineer' },
  template: { id: 't1', name: 'Standard' },
  content: 'x',
  designation: null,
  department: null,
  branch: null,
  reportingManager: null,
  employmentType: 'PERMANENT',
  annualCtc: 1200000,
  monthlyBasePay: null,
  salaryStructure: null,
  joiningDate: '2026-04-01',
  expiresAt: '2026-03-25T12:00:00.000Z',
  status: 'SENT',
  sentAt: '2026-03-15T12:00:00.000Z',
  respondedAt: null,
  acceptedName: null,
  declineReason: null,
  decisionNote: null,
  employeeId: null,
  convertedAt: null,
  createdAt: '2026-03-14T12:00:00.000Z',
};

describe('OffersPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(true);
  });

  it('lists offers with a link to the application', async () => {
    mockApi.listOffers.mockResolvedValue({ data: [offer] } as any);
    render(<OffersPage />);

    const link = await screen.findByText('Asha Rao');
    expect(link.closest('a')).toHaveAttribute('href', '/recruitment/applications/app-1');
    expect(screen.getByText('₹12,00,000')).toBeInTheDocument();
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    expect(mockApi.listOffers).toHaveBeenCalledWith(undefined);
  });

  it('filters by status', async () => {
    mockApi.listOffers.mockResolvedValue({ data: [] } as any);
    render(<OffersPage />);
    await screen.findByText('No offers yet.');

    fireEvent.click(screen.getByRole('tab', { name: 'Accepted' }));
    await waitFor(() => expect(mockApi.listOffers).toHaveBeenLastCalledWith({ status: 'ACCEPTED' }));
    expect(await screen.findByText('No offers with this status.')).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    mockApi.listOffers.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ data: [offer] } as any);
    render(<OffersPage />);
    fireEvent.click(await screen.findByText('Retry'));
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  });

  it('is HR only', () => {
    mockHasRole.mockReturnValue(false);
    render(<OffersPage />);
    expect(screen.getByText('Only HR can view offers.')).toBeInTheDocument();
    expect(mockApi.listOffers).not.toHaveBeenCalled();
  });
});
