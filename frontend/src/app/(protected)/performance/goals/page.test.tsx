import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import GoalsPage from './page';
import { goalsApi } from '@/lib/api-performance-goals';

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_t, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

let mockUser: any;
let mockFlags: { isAdmin: boolean; isManager: boolean };
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, ...mockFlags }),
}));

jest.mock('@/lib/api', () => ({
  api: {},
  departmentsApi: { getAll: jest.fn().mockResolvedValue({ data: [] }) },
}));
jest.mock('@/lib/api-performance-reviews', () => ({
  reviewsApi: { myReviews: jest.fn().mockResolvedValue({ data: { data: [] } }) },
}));
jest.mock('@/lib/api-performance-goals', () => ({
  goalsApi: {
    tree: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addKeyResult: jest.fn(),
    updateKeyResult: jest.fn(),
    removeKeyResult: jest.fn(),
  },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const base = {
  ownerType: 'COMPANY', description: null, targetDate: '2026-12-31T00:00:00Z', status: 'IN_PROGRESS', progress: 50,
  weight: 1, shareOnFeed: false, completedAt: null, reviewId: null, parentGoalId: null, employeeId: null,
  departmentId: null, keyResults: [], isDerived: false, canEdit: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  (goalsApi.tree as jest.Mock).mockResolvedValue({
    data: [{ ...base, id: 'g1', title: 'Company goal', children: [{ ...base, id: 'g2', title: 'Nested child', ownerType: 'EMPLOYEE', children: [] }] }],
  });
  (goalsApi.list as jest.Mock).mockResolvedValue({ data: [] });
});

describe('GoalsPage', () => {
  it('shows an employee no admin buttons and no team tab', async () => {
    mockUser = { role: 'EMPLOYEE', employee: { id: 'e1' } };
    mockFlags = { isAdmin: false, isManager: false };
    render(<GoalsPage />);
    await waitFor(() => expect(screen.getByText('Company goal')).toBeInTheDocument());
    expect(screen.getByText('New goal')).toBeInTheDocument();
    expect(screen.queryByText('New company goal')).not.toBeInTheDocument();
    expect(screen.queryByText('New department goal')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Team goals' })).not.toBeInTheDocument();
  });

  it('renders nested children in the alignment tree', async () => {
    mockUser = { role: 'EMPLOYEE', employee: { id: 'e1' } };
    mockFlags = { isAdmin: false, isManager: false };
    render(<GoalsPage />);
    await waitFor(() => expect(screen.getByText('Nested child')).toBeInTheDocument());
  });

  it('shows admins the company and department goal buttons and the team tab', async () => {
    mockUser = { role: 'HR_ADMIN', employee: { id: 'e9' } };
    mockFlags = { isAdmin: true, isManager: true };
    render(<GoalsPage />);
    await waitFor(() => expect(screen.getByText('Company goal')).toBeInTheDocument());
    expect(screen.getByText('New company goal')).toBeInTheDocument();
    expect(screen.getByText('New department goal')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Team goals' })).toBeInTheDocument();
  });

  it('loads the selected scope when switching tabs', async () => {
    mockUser = { role: 'EMPLOYEE', employee: { id: 'e1' } };
    mockFlags = { isAdmin: false, isManager: false };
    render(<GoalsPage />);
    await waitFor(() => expect(goalsApi.tree).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'My goals' }));
    await waitFor(() => expect(goalsApi.list).toHaveBeenCalledWith({ scope: 'mine' }));
  });

  it('ignores a slow earlier response that resolves after a later tab load', async () => {
    mockUser = { role: 'EMPLOYEE', employee: { id: 'e1' } };
    mockFlags = { isAdmin: false, isManager: false };
    let resolveCompany!: (v: unknown) => void;
    (goalsApi.list as jest.Mock).mockImplementation(({ scope }: { scope: string }) =>
      scope === 'company'
        ? new Promise((r) => { resolveCompany = r; })
        : Promise.resolve({ data: [{ ...base, id: 'gd', title: 'Department goal row', ownerType: 'DEPARTMENT' }] }),
    );
    render(<GoalsPage />);
    await waitFor(() => expect(goalsApi.tree).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'Company' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Department' }));
    await waitFor(() => expect(screen.getByText('Department goal row')).toBeInTheDocument());
    resolveCompany({ data: [{ ...base, id: 'gc', title: 'Stale company row' }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText('Stale company row')).not.toBeInTheDocument();
    expect(screen.getByText('Department goal row')).toBeInTheDocument();
  });
});
