import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import NineBoxPage from './page';
import { calibrationApi } from '@/lib/api-performance-calibration';

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_t, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'MANAGER', employee: { id: 'e1' } }, isAdmin: false, isManager: true }),
}));
jest.mock('@/lib/api', () => ({
  api: {},
  performanceApi: {
    getCycles: jest.fn().mockResolvedValue({ data: { data: [{ id: 'c1', name: 'FY26 H1', status: 'ACTIVE' }], meta: {} } }),
  },
  departmentsApi: { getAll: jest.fn().mockResolvedValue({ data: [{ id: 'd1', name: 'Engineering' }] }) },
}));
jest.mock('@/lib/api-performance-calibration', () => ({ calibrationApi: { nineBox: jest.fn() } }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const bands = ['LOW', 'MEDIUM', 'HIGH'] as const;
const person = (id: string, name: string) => ({
  reviewId: `r-${id}`, employeeId: id, name, designation: 'Engineer', departmentName: 'Engineering', finalRating: 5, potentialRating: 5,
});

beforeEach(() => {
  const cells = [];
  for (const potential of bands) for (const performance of bands) {
    let employees: any[] = [];
    if (performance === 'HIGH' && potential === 'HIGH') employees = [person('e1', 'Ann Star')];
    if (performance === 'LOW' && potential === 'LOW') employees = [person('e2', 'Rob Risk')];
    if (performance === 'MEDIUM' && potential === 'MEDIUM') employees = [person('e3', 'Cora Core')];
    cells.push({ performance, potential, employees });
  }
  (calibrationApi.nineBox as jest.Mock).mockResolvedValue({
    data: { cells, missing: [{ reviewId: 'r9', employeeId: 'e9', name: 'Mia Missing', missingRating: false, missingPotential: true }] },
  });
});

describe('NineBoxPage', () => {
  it('places employee chips in the right cell', async () => {
    render(<NineBoxPage />);
    await waitFor(() => expect(screen.getByText('Ann Star')).toBeInTheDocument());
    expect(within(screen.getByTestId('cell-HIGH-HIGH')).getByText('Ann Star')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-HIGH-HIGH')).getByText('Star')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-LOW-LOW')).getByText('Rob Risk')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-LOW-LOW')).getByText('Risk')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-MEDIUM-MEDIUM')).getByText('Cora Core')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-MEDIUM-MEDIUM')).getByText('Core player')).toBeInTheDocument();
    expect(within(screen.getByTestId('cell-HIGH-LOW')).queryByText('Ann Star')).not.toBeInTheDocument();
  });

  it('lists unplaced people with the reason they are missing', async () => {
    render(<NineBoxPage />);
    await waitFor(() => expect(screen.getByText('Mia Missing')).toBeInTheDocument());
    expect(screen.getByText(/potential rating missing/i)).toBeInTheDocument();
  });

  it('renders potential rows with HIGH on top', async () => {
    render(<NineBoxPage />);
    await waitFor(() => expect(screen.getByText('Ann Star')).toBeInTheDocument());
    const cells = screen.getAllByTestId(/^cell-/).map((c) => c.getAttribute('data-testid'));
    expect(cells.slice(0, 3)).toEqual(['cell-LOW-HIGH', 'cell-MEDIUM-HIGH', 'cell-HIGH-HIGH']);
    expect(cells.slice(6)).toEqual(['cell-LOW-LOW', 'cell-MEDIUM-LOW', 'cell-HIGH-LOW']);
  });
});
