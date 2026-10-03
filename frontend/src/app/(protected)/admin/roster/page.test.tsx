import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import AdminRosterPage from './page';

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

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'hr@test.com', role: 'HR_ADMIN', tenantId: 't1', employee: { id: 'hr-1' } },
    isAuthenticated: true,
    isLoading: false,
    hasRole: jest.fn().mockReturnValue(true),
    hasPermission: jest.fn().mockReturnValue(true),
  }),
}));

jest.mock('@/lib/api-roster', () => ({
  rosterApi: {
    listPatterns: jest.fn(),
    createPattern: jest.fn(),
    updatePattern: jest.fn(),
    deletePattern: jest.fn(),
    apply: jest.fn(),
    getGrid: jest.fn(),
    updateCells: jest.fn(),
    getMine: jest.fn(),
  },
}));

jest.mock('@/lib/api', () => ({
  api: {},
  shiftsApi: { getAll: jest.fn() },
  employeesApi: { getAll: jest.fn() },
  departmentsApi: { getAll: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { rosterApi } = require('@/lib/api-roster');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { shiftsApi, employeesApi, departmentsApi } = require('@/lib/api');

const shifts = [
  {
    id: 's1',
    name: 'General',
    code: 'GEN',
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 60,
    standardWorkMinutes: 480,
    graceMinutes: 15,
    isActive: true,
  },
  {
    id: 's2',
    name: 'Night',
    code: 'NGT',
    startTime: '22:00',
    endTime: '06:00',
    breakMinutes: 30,
    standardWorkMinutes: 480,
    graceMinutes: 15,
    isActive: true,
  },
];

const grid = {
  days: ['2026-03-16', '2026-03-17'],
  rows: [
    {
      employee: { id: 'e1', name: 'Asha Rao', code: 'EMP001', department: 'Ops' },
      cells: [
        {
          date: '2026-03-16',
          shiftId: 's1',
          shiftCode: 'GEN',
          shiftName: 'General',
          isOvernight: false,
          isOff: false,
          source: 'ROSTER',
        },
        {
          date: '2026-03-17',
          shiftId: null,
          shiftCode: null,
          shiftName: null,
          isOvernight: false,
          isOff: true,
          source: 'ROSTER',
        },
      ],
    },
  ],
};

const pattern = {
  id: 'p1',
  name: '2 on 1 off',
  description: null,
  cycleLength: 3,
  isActive: true,
  days: [
    { dayIndex: 0, shiftId: 's1' },
    { dayIndex: 1, shiftId: 's1' },
    { dayIndex: 2, shiftId: null },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  rosterApi.getGrid.mockResolvedValue({ data: grid });
  rosterApi.listPatterns.mockResolvedValue({ data: [pattern] });
  shiftsApi.getAll.mockResolvedValue({ data: shifts });
  employeesApi.getAll.mockResolvedValue({
    data: {
      data: [
        { id: 'e1', firstName: 'Asha', lastName: 'Rao', employeeCode: 'EMP001' },
        { id: 'e2', firstName: 'Ben', lastName: 'Das', employeeCode: 'EMP002' },
      ],
    },
  });
  departmentsApi.getAll.mockResolvedValue({ data: [{ id: 'd1', name: 'Ops' }] });
});

async function openPatternsTab() {
  fireEvent.click(await screen.findByRole('button', { name: 'Rotation patterns' }));
}

describe('AdminRosterPage', () => {
  it('shows the editable roster grid first', async () => {
    render(<AdminRosterPage />);

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(rosterApi.getGrid).toHaveBeenCalledTimes(1);
    expect(rosterApi.getGrid.mock.calls[0][0]).toMatchObject({
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    // Editable: a cell opens the picker.
    fireEvent.click(screen.getByTestId('cell-e1-2026-03-17'));
    expect(screen.getByTestId('pick-off')).toBeInTheDocument();
  });

  it('pages through employees when there are more than one page', async () => {
    rosterApi.getGrid.mockResolvedValue({
      data: { ...grid, meta: { total: 120, page: 1, limit: 50, totalPages: 3 } },
    });
    render(<AdminRosterPage />);
    await screen.findByText('Asha Rao');
    expect(rosterApi.getGrid.mock.calls[0][0].page).toBeUndefined();
    expect(screen.getByText('Page 1 of 3 (120 employees)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(rosterApi.getGrid).toHaveBeenCalledTimes(2));
    expect(rosterApi.getGrid.mock.calls[1][0].page).toBe(2);
  });

  it('shows no pager when everything fits one page', async () => {
    rosterApi.getGrid.mockResolvedValue({
      data: { ...grid, meta: { total: 1, page: 1, limit: 50, totalPages: 1 } },
    });
    render(<AdminRosterPage />);
    await screen.findByText('Asha Rao');
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('shows a loading state, then an error with retry', async () => {
    rosterApi.getGrid.mockRejectedValueOnce(new Error('boom'));
    render(<AdminRosterPage />);

    expect(screen.getByText('Loading roster...')).toBeInTheDocument();
    expect(await screen.findByText('Failed to load the roster.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  });

  it('moves the window by its span with Next and Previous', async () => {
    render(<AdminRosterPage />);
    await screen.findByText('Asha Rao');
    const first = rosterApi.getGrid.mock.calls[0][0].from as string;

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(rosterApi.getGrid).toHaveBeenCalledTimes(2));
    const second = rosterApi.getGrid.mock.calls[1][0].from as string;
    const days = (a: string, b: string) =>
      Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
    expect(days(first, second)).toBe(7);

    fireEvent.click(screen.getByRole('button', { name: '14 days' }));
    await waitFor(() => expect(rosterApi.getGrid).toHaveBeenCalledTimes(3));
    const third = rosterApi.getGrid.mock.calls[2][0];
    expect(days(third.from, third.to)).toBe(13);
  });

  it('saves edited cells through the cells endpoint and reloads', async () => {
    rosterApi.updateCells.mockResolvedValue({ data: [] });
    render(<AdminRosterPage />);
    await screen.findByText('Asha Rao');

    fireEvent.click(screen.getByTestId('cell-e1-2026-03-16'));
    fireEvent.click(screen.getByTestId('pick-off'));
    fireEvent.click(screen.getByText('Save (1)'));

    await waitFor(() =>
      expect(rosterApi.updateCells).toHaveBeenCalledWith([
        { employeeId: 'e1', date: '2026-03-16', isOff: true },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(rosterApi.getGrid).toHaveBeenCalledTimes(2));
  });

  it('lists rotation patterns on its tab', async () => {
    render(<AdminRosterPage />);
    await openPatternsTab();

    expect(await screen.findByText('2 on 1 off')).toBeInTheDocument();
    expect(rosterApi.listPatterns).toHaveBeenCalled();
    expect(screen.getByText('3-day cycle')).toBeInTheDocument();
  });

  it('shows an empty state when there are no patterns', async () => {
    rosterApi.listPatterns.mockResolvedValue({ data: [] });
    render(<AdminRosterPage />);
    await openPatternsTab();

    expect(await screen.findByText('No rotation patterns yet.')).toBeInTheDocument();
  });

  it('creates a pattern with three days, sending null for OFF', async () => {
    rosterApi.createPattern.mockResolvedValue({ data: { ...pattern, id: 'p2' } });
    render(<AdminRosterPage />);
    await openPatternsTab();
    await screen.findByText('2 on 1 off');

    fireEvent.click(screen.getByRole('button', { name: 'New pattern' }));
    fireEvent.change(screen.getByLabelText('Pattern name'), { target: { value: 'Rota A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add day' }));

    fireEvent.change(screen.getByLabelText('Day 1 shift'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Day 2 shift'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Day 3 shift'), { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pattern' }));

    await waitFor(() =>
      expect(rosterApi.createPattern).toHaveBeenCalledWith({
        name: 'Rota A',
        days: ['s1', null, 's2'],
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('refuses to save a pattern without a name', async () => {
    render(<AdminRosterPage />);
    await openPatternsTab();
    await screen.findByText('2 on 1 off');

    fireEvent.click(screen.getByRole('button', { name: 'New pattern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save pattern' }));

    expect(rosterApi.createPattern).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('applies a pattern to employees and reports created, updated and skipped', async () => {
    rosterApi.apply.mockResolvedValue({ data: { created: 3, updated: 1, skippedManual: 2 } });
    render(<AdminRosterPage />);
    await openPatternsTab();
    await screen.findByText('2 on 1 off');

    fireEvent.click(screen.getByRole('button', { name: 'Apply to employees' }));
    const dialog = await screen.findByTestId('apply-form');
    fireEvent.click(await within(dialog).findByLabelText('Asha Rao (EMP001)'));
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-03-16' } });
    fireEvent.change(within(dialog).getByLabelText('End date'), { target: { value: '2026-03-29' } });
    fireEvent.change(within(dialog).getByLabelText('Cycle offset'), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByLabelText('Overwrite manual entries'));
    fireEvent.click(screen.getByTestId('apply-submit'));

    await waitFor(() =>
      expect(rosterApi.apply).toHaveBeenCalledWith({
        patternId: 'p1',
        employeeIds: ['e1'],
        startDate: '2026-03-16',
        endDate: '2026-03-29',
        cycleOffset: 1,
        overwriteManual: true,
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/3 created.*1 updated.*2 skipped/),
      ),
    );
  });

  it('requires at least one employee to apply', async () => {
    render(<AdminRosterPage />);
    await openPatternsTab();
    await screen.findByText('2 on 1 off');

    fireEvent.click(screen.getByRole('button', { name: 'Apply to employees' }));
    await screen.findByTestId('apply-form');
    fireEvent.click(screen.getByTestId('apply-submit'));

    expect(rosterApi.apply).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('deletes a pattern after confirmation', async () => {
    rosterApi.deletePattern.mockResolvedValue({ data: undefined });
    render(<AdminRosterPage />);
    await openPatternsTab();
    await screen.findByText('2 on 1 off');

    fireEvent.click(screen.getByRole('button', { name: 'Delete pattern' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(rosterApi.deletePattern).toHaveBeenCalledWith('p1'));
  });
});
