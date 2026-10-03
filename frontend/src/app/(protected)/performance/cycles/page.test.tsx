import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ReviewCyclesPage from './page';
import { performanceApi } from '@/lib/api';
import { templatesApi } from '@/lib/api-performance-templates';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

// Mock AuthContext
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', role: 'HR_ADMIN', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isManager: true,
    isAdmin: true,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(true),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

// Mock API modules
jest.mock('@/lib/api', () => ({
  api: { defaults: { headers: { common: {} } }, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
  performanceApi: {
    getCycles: jest.fn(),
    createCycle: jest.fn(),
    updateCycle: jest.fn(),
    deleteCycle: jest.fn(),
    launchCycle: jest.fn(),
    completeCycle: jest.fn(),
  },
}));
jest.mock('@/lib/api-performance-templates', () => ({ templatesApi: { list: jest.fn() } }));

// Mock @/types
jest.mock('@/types', () => ({
  ReviewCycleStatus: { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED' },
}));

const api = performanceApi as jest.Mocked<typeof performanceApi>;
const templates = templatesApi as jest.Mocked<typeof templatesApi>;
const META = { total: 1, page: 1, limit: 20, totalPages: 1 };

const draft = {
  id: 'c1', tenantId: 't1', name: 'H1 2026', description: 'Half year', startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-06-30T00:00:00Z', status: 'DRAFT', createdAt: '', updatedAt: '', _count: { reviews: 0 },
  templateId: null, peerFeedbackEnabled: false, maxPeers: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getCycles.mockResolvedValue({ data: { data: [], meta: { ...META, total: 0, totalPages: 0 } } } as never);
  templates.list.mockResolvedValue({
    data: [
      { id: 't1', name: 'Engineering template', description: null, isActive: true, questions: [] },
      { id: 't2', name: 'Retired template', description: null, isActive: false, questions: [] },
    ],
  } as never);
});

describe('ReviewCyclesPage', () => {
  it('renders the Review Cycles heading', async () => {
    render(<ReviewCyclesPage />);
    await waitFor(() => {
      expect(screen.getByText('Review Cycles')).toBeInTheDocument();
    });
  });

  it('renders the Create Cycle button', async () => {
    render(<ReviewCyclesPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Create Cycle').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the empty state when no cycles exist', async () => {
    render(<ReviewCyclesPage />);
    await waitFor(() => {
      expect(screen.getByText('No review cycles')).toBeInTheDocument();
    });
  });

  it('offers only active templates and reveals max peers when peer feedback is on', async () => {
    render(<ReviewCyclesPage />);
    fireEvent.click((await screen.findAllByText('Create Cycle'))[0]);
    const select = await screen.findByLabelText('Review template');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Engineering template' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Retired template' })).not.toBeInTheDocument();
    expect(select).toBeEnabled();

    expect(screen.queryByLabelText('Max peers')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Enable 360 peer feedback'));
    const max = screen.getByLabelText('Max peers');
    expect(max).toHaveValue(5);
    expect(max).toHaveAttribute('min', '1');
    expect(max).toHaveAttribute('max', '10');
  });

  it('saves template, peer toggle and max peers on a draft cycle', async () => {
    api.getCycles.mockResolvedValue({ data: { data: [draft], meta: META } } as never);
    api.updateCycle.mockResolvedValue({ data: draft } as never);
    render(<ReviewCyclesPage />);
    fireEvent.click(await screen.findByTitle('Edit'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Engineering template' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Review template'), { target: { value: 't1' } });
    fireEvent.click(screen.getByLabelText('Enable 360 peer feedback'));
    fireEvent.change(screen.getByLabelText('Max peers'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(api.updateCycle).toHaveBeenCalledTimes(1));
    expect(api.updateCycle).toHaveBeenCalledWith('c1', {
      name: 'H1 2026',
      description: 'Half year',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      templateId: 't1',
      peerFeedbackEnabled: true,
      maxPeers: 7,
    });
  });

  it('disables the new fields for a cycle that is not a draft', async () => {
    const active = { ...draft, status: 'ACTIVE', templateId: 't1', peerFeedbackEnabled: true, maxPeers: 4 };
    api.getCycles.mockResolvedValue({ data: { data: [active], meta: META } } as never);
    render(<ReviewCyclesPage />);
    fireEvent.click(await screen.findByTitle('View settings'));
    expect(await screen.findByLabelText('Review template')).toBeDisabled();
    expect(screen.getByLabelText('Enable 360 peer feedback')).toBeDisabled();
    expect(screen.getByLabelText('Max peers')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
  });

  it('keeps the current template in the select even when it is inactive', async () => {
    const withRetired = { ...draft, templateId: 't2' };
    api.getCycles.mockResolvedValue({ data: { data: [withRetired], meta: META } } as never);
    render(<ReviewCyclesPage />);
    fireEvent.click(await screen.findByTitle('Edit'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Retired template (inactive)' })).toBeInTheDocument());
    expect(screen.getByLabelText('Review template')).toHaveValue('t2');
  });
});
