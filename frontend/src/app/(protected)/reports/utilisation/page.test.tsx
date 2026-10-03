import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import UtilisationPage from './page';
import { utilisationApi } from '@/lib/api-utilisation';
import { projectsApi } from '@/lib/api-projects';
import { departmentsApi } from '@/lib/api';

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

let mockAuth: any;
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('@/lib/api-utilisation', () => ({
  utilisationApi: { get: jest.fn(), exportCsv: jest.fn() },
}));
jest.mock('@/lib/api-projects', () => ({
  projectsApi: { list: jest.fn() },
}));
jest.mock('@/lib/api', () => ({
  departmentsApi: { getAll: jest.fn() },
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (m: string) => mockToast.success(m),
    error: (m: string) => mockToast.error(m),
  },
}));

const api = utilisationApi as jest.Mocked<typeof utilisationApi>;
const projects = projectsApi as jest.Mocked<typeof projectsApi>;
const departments = departmentsApi as jest.Mocked<typeof departmentsApi>;

const DASH = '—';

const employeeReport = {
  query: { from: '2026-03-01', to: '2026-03-31', groupBy: 'employee' },
  generatedAt: '2026-03-18T12:00:00.000Z',
  rows: [
    {
      employeeId: 'e1',
      name: 'Asha Rao',
      code: 'E001',
      department: 'Engineering',
      capacityHours: 160,
      loggedHours: 120,
      billableHours: 80,
      utilisationPct: 75,
      billablePct: 50,
    },
    {
      employeeId: 'e2',
      name: 'Bina Das',
      code: 'E002',
      department: null,
      capacityHours: 0,
      loggedHours: 4,
      billableHours: 0,
      utilisationPct: null,
      billablePct: null,
    },
  ],
  totals: {
    capacityHours: 160,
    loggedHours: 124,
    billableHours: 80,
    utilisationPct: 77.5,
    billablePct: 50,
  },
};

const projectReport = {
  query: { from: '2026-03-01', to: '2026-03-31', groupBy: 'project' },
  generatedAt: '2026-03-18T12:00:00.000Z',
  rows: [
    {
      projectId: 'p1',
      code: 'ALPHA',
      name: 'Alpha',
      loggedHours: 100,
      billableHours: 90,
      billableSharePct: 90,
      contributors: 4,
    },
  ],
  totals: { loggedHours: 100, billableHours: 90, billableSharePct: 90, contributors: 4 },
};

beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-03-18T12:00:00Z'),
    doNotFake: [
      'nextTick',
      'setImmediate',
      'setTimeout',
      'setInterval',
      'clearTimeout',
      'clearInterval',
      'clearImmediate',
      'queueMicrotask',
      'performance',
      'hrtime',
    ],
  });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { id: 'u1', role: 'HR_ADMIN', employee: { id: 'emp-hr' } },
    hasRole: jest.fn().mockReturnValue(true),
    hasPermission: jest.fn().mockReturnValue(false),
  };
  api.get.mockImplementation(((q: any) =>
    Promise.resolve({ data: q.groupBy === 'project' ? projectReport : employeeReport })) as any);
  projects.list.mockResolvedValue({
    data: { data: [{ id: 'p1', code: 'ALPHA', name: 'Alpha' }], meta: {} },
  } as any);
  departments.getAll.mockResolvedValue({ data: [{ id: 'd1', name: 'Engineering' }] } as any);
});

describe('Utilisation report page', () => {
  it('defaults to this month grouped by employee', async () => {
    render(<UtilisationPage />);
    await screen.findByText('Asha Rao');
    expect(api.get).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-03-01', to: '2026-03-31', groupBy: 'employee' }),
    );
    expect(screen.getByLabelText('From')).toHaveValue('2026-03-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-03-31');
  });

  it('renders percentages with a percent sign and a dash for null', async () => {
    render(<UtilisationPage />);
    const row = (await screen.findByText('Asha Rao')).closest('tr') as HTMLElement;
    expect(within(row).getByText('75%')).toBeInTheDocument();
    expect(within(row).getByText('50%')).toBeInTheDocument();
    expect(within(row).getByText('160')).toBeInTheDocument();

    const nullRow = screen.getByText('Bina Das').closest('tr') as HTMLElement;
    expect(within(nullRow).getAllByText(DASH).length).toBeGreaterThanOrEqual(2);
  });

  it('shows a totals row', async () => {
    render(<UtilisationPage />);
    await screen.findByText('Asha Rao');
    const totals = screen.getByTestId('totals-row');
    expect(within(totals).getByText('77.5%')).toBeInTheDocument();
    expect(within(totals).getByText('124')).toBeInTheDocument();
  });

  it('re-queries by project when toggled', async () => {
    render(<UtilisationPage />);
    await screen.findByText('Asha Rao');

    fireEvent.click(screen.getByRole('button', { name: /by project/i }));

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: 'project' })),
    );
    expect(await screen.findByText('ALPHA')).toBeInTheDocument();
    expect(screen.getByText('Contributors')).toBeInTheDocument();
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0);
  });

  it('switches the range with the presets', async () => {
    render(<UtilisationPage />);
    await screen.findByText('Asha Rao');

    fireEvent.click(screen.getByRole('button', { name: /last month/i }));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: '2026-02-01', to: '2026-02-28' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: /last 4 weeks/i }));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: '2026-02-19', to: '2026-03-18' }),
      ),
    );
  });

  it('passes the department filter and the include-submitted toggle', async () => {
    render(<UtilisationPage />);
    await screen.findByText('Asha Rao');

    fireEvent.change(await screen.findByLabelText('Department'), { target: { value: 'd1' } });
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.objectContaining({ departmentId: 'd1' })),
    );

    fireEvent.click(screen.getByLabelText(/include submitted/i));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        expect.objectContaining({ departmentId: 'd1', includeSubmitted: true }),
      ),
    );
  });

  it('downloads the CSV through a blob', async () => {
    const blob = new Blob(['a,b'], { type: 'text/csv' });
    api.exportCsv.mockResolvedValue({ data: blob } as any);
    const createUrl = jest.fn().mockReturnValue('blob:csv');
    const revokeUrl = jest.fn();
    (URL as any).createObjectURL = createUrl;
    (URL as any).revokeObjectURL = revokeUrl;
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<UtilisationPage />);
    await screen.findByText('Asha Rao');
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }));

    await waitFor(() =>
      expect(api.exportCsv).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-03-01', to: '2026-03-31', groupBy: 'employee' }),
      ),
    );
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(revokeUrl).toHaveBeenCalledWith('blob:csv');
    click.mockRestore();
  });

  it('reports a failed download', async () => {
    api.exportCsv.mockRejectedValue(new Error('boom'));
    render(<UtilisationPage />);
    await screen.findByText('Asha Rao');
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('shows an empty state when there is nothing to report', async () => {
    api.get.mockResolvedValue({ data: { ...employeeReport, rows: [] } } as any);
    render(<UtilisationPage />);
    expect(await screen.findByText(/no data for this range/i)).toBeInTheDocument();
  });

  it('explains a 403 and offers a retry for other failures', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 403, data: { message: 'No scope' } } });
    render(<UtilisationPage />);
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();

    api.get.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: /by project/i }));
    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('ALPHA')).toBeInTheDocument();
  });

  it('defaults to the project view for someone who may not see employees', async () => {
    mockAuth = {
      user: { id: 'u1', role: 'EMPLOYEE', employee: { id: 'emp-lead' } },
      hasRole: jest.fn().mockReturnValue(false),
      hasPermission: jest.fn().mockReturnValue(false),
    };
    render(<UtilisationPage />);
    expect(await screen.findByText('ALPHA')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(expect.objectContaining({ groupBy: 'project' }));
    expect(screen.queryByRole('button', { name: /by employee/i })).not.toBeInTheDocument();
  });
});
