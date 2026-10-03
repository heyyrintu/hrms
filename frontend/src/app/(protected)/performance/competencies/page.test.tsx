import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CompetenciesPage from './page';
import { competenciesApi } from '@/lib/api-performance-competencies';
import toast from 'react-hot-toast';

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_t, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

let mockIsAdmin = true;
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockIsAdmin ? 'HR_ADMIN' : 'EMPLOYEE', employee: { id: 'e1' } }, isAdmin: mockIsAdmin, isManager: mockIsAdmin }),
}));
jest.mock('@/lib/api', () => ({
  api: {},
  designationsApi: { getAll: jest.fn().mockResolvedValue({ data: [{ id: 'des1', name: 'Engineer' }] }) },
}));
jest.mock('@/lib/api-performance-competencies', () => ({
  competenciesApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    forDesignation: jest.fn(),
    setForDesignation: jest.fn(),
  },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const comp = (over: any = {}) => ({ id: 'k1', name: 'Communication', description: 'Clear writing', category: 'Core', isActive: true, mappedDesignations: 0, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAdmin = true;
  (competenciesApi.list as jest.Mock).mockResolvedValue({ data: [comp(), comp({ id: 'k2', name: 'Leadership', mappedDesignations: 2 })] });
  (competenciesApi.forDesignation as jest.Mock).mockResolvedValue({
    data: [{ competencyId: 'k1', expectedLevel: 4, competency: { id: 'k1', name: 'Communication', isActive: true } }],
  });
  (competenciesApi.setForDesignation as jest.Mock).mockResolvedValue({ data: [] });
});

describe('CompetenciesPage', () => {
  it('denies access to non-admins', async () => {
    mockIsAdmin = false;
    render(<CompetenciesPage />);
    expect(screen.getByText('You do not have access')).toBeInTheDocument();
    expect(competenciesApi.list).not.toHaveBeenCalled();
  });

  it('lists the library', async () => {
    render(<CompetenciesPage />);
    await waitFor(() => expect(screen.getByText('Communication')).toBeInTheDocument());
    expect(screen.getByText('Leadership')).toBeInTheDocument();
  });

  it('shows the 400 message from the server when a delete is refused', async () => {
    (competenciesApi.remove as jest.Mock).mockRejectedValue({ response: { data: { message: 'Competency is mapped to designations' } } });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CompetenciesPage />);
    await waitFor(() => expect(screen.getByText('Leadership')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Delete Leadership'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Competency is mapped to designations'));
  });

  it('deactivates a competency via update', async () => {
    (competenciesApi.update as jest.Mock).mockResolvedValue({ data: {} });
    render(<CompetenciesPage />);
    await waitFor(() => expect(screen.getByText('Communication')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Deactivate Communication'));
    await waitFor(() => expect(competenciesApi.update).toHaveBeenCalledWith('k1', { isActive: false }));
  });

  it('saves the designation mapping through setForDesignation', async () => {
    render(<CompetenciesPage />);
    await waitFor(() => expect(screen.getByText('Communication')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Designation mapping' }));
    const select = await screen.findByLabelText('Designation');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Engineer' })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: 'des1' } });
    await waitFor(() => expect(competenciesApi.forDesignation).toHaveBeenCalledWith('des1'));
    const level = await screen.findByLabelText('Expected level for Communication');
    fireEvent.change(level, { target: { value: '5' } });
    fireEvent.click(screen.getByText('Save mapping'));
    await waitFor(() =>
      expect(competenciesApi.setForDesignation).toHaveBeenCalledWith('des1', [{ competencyId: 'k1', expectedLevel: 5 }]),
    );
  });
});
