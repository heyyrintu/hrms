import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import OpeningDetailPage from './page';
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

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'open-1' }),
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

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAdmin: true }),
}));

jest.mock('@/lib/api-recruitment', () => {
  const actual = jest.requireActual('@/lib/api-recruitment');
  return {
    ...actual,
    recruitmentApi: {
      getOpening: jest.fn(),
      listStages: jest.fn(),
      listOpeningApplications: jest.fn(),
      moveApplication: jest.fn(),
      rejectApplication: jest.fn(),
      publishOpening: jest.fn(),
      holdOpening: jest.fn(),
      closeOpening: jest.fn(),
    },
  };
});

const api = recruitmentApi as jest.Mocked<typeof recruitmentApi>;

const stage = (id: string, name: string, sortOrder: number, category: string) => ({
  id,
  name,
  sortOrder,
  category,
  isActive: true,
});

const stages = [
  stage('st-applied', 'Applied', 1, 'APPLIED'),
  stage('st-screen', 'Screening', 2, 'SCREENING'),
  stage('st-offer', 'Offer', 3, 'OFFER'),
  stage('st-hired', 'Hired', 4, 'HIRED'),
  stage('st-rejected', 'Rejected', 5, 'REJECTED'),
];

describe('OpeningDetailPage board', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getOpening.mockResolvedValue({
      data: { id: 'open-1', title: 'Backend Engineer', status: 'OPEN', positions: 1, department: null },
    } as any);
    api.listStages.mockResolvedValue({ data: stages } as any);
    api.listOpeningApplications.mockResolvedValue({
      data: [
        {
          id: 'app-1',
          candidate: { id: 'c1', firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', currentTitle: null },
          stage: stages[0],
          status: 'ACTIVE',
          source: 'DIRECT',
          appliedAt: '2026-03-15T12:00:00Z',
          stageChangedAt: '2026-03-15T12:00:00Z',
          interviewCount: 0,
        },
      ],
    } as any);
  });

  it('does not offer Hired (or Rejected) as a manual move target: hiring happens through offer conversion', async () => {
    render(<OpeningDetailPage />);

    const select = await screen.findByDisplayValue('Move to...');
    const labels = within(select as HTMLElement)
      .getAllByRole('option')
      .map((o) => o.textContent);

    expect(labels).toEqual(['Move to...', 'Screening', 'Offer']);
    await waitFor(() => expect(api.listOpeningApplications).toHaveBeenCalledWith('open-1'));
  });
});
