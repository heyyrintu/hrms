import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import TimesheetsPage from './page';
import { timesheetsApi } from '@/lib/api-timesheets';
import { projectsApi } from '@/lib/api-projects';

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

jest.mock('@/lib/api-timesheets', () => ({
  timesheetsApi: {
    getMyWeek: jest.fn(),
    saveEntries: jest.fn(),
    submit: jest.fn(),
    recall: jest.fn(),
  },
}));

jest.mock('@/lib/api-projects', () => ({
  projectsApi: { loggable: jest.fn() },
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (m: string) => mockToast.success(m),
    error: (m: string) => mockToast.error(m),
  },
}));

const ts = timesheetsApi as jest.Mocked<typeof timesheetsApi>;
const projects = projectsApi as jest.Mocked<typeof projectsApi>;

const WEEK = '2026-03-16'; // the Monday of "today"

const loggable = [
  {
    id: 'p1',
    code: 'ALPHA',
    name: 'Alpha',
    billable: true,
    member: { startDate: '2026-01-01', endDate: null },
    tasks: [],
  },
  {
    id: 'p2',
    code: 'BETA',
    name: 'Beta',
    billable: true,
    member: { startDate: '2026-01-01', endDate: '2026-03-17' },
    tasks: [{ id: 't1', name: 'Build', billable: null, effectiveBillable: true }],
  },
];

const emptyWeek = { timesheet: null, entries: [], attendedMinutesByDate: {} };

const savedWeek = (status: string, extra: Record<string, unknown> = {}) => ({
  timesheet: {
    id: 'ts-1',
    employeeId: 'emp-1',
    weekStart: WEEK,
    status,
    totalHours: 8,
    submittedAt: null,
    decidedAt: null,
    approverNote: null,
    ...extra,
  },
  entries: [
    {
      id: 'e1',
      date: WEEK,
      projectId: 'p1',
      taskId: null,
      hours: 8,
      billable: true,
      note: 'sprint work',
      project: { id: 'p1', code: 'ALPHA', name: 'Alpha' },
      task: null,
    },
  ],
  attendedMinutesByDate: {},
});

const mockWeek = (week: unknown) => ts.getMyWeek.mockResolvedValue({ data: week } as any);

beforeAll(() => {
  // Fake only the clock: 18 Mar 2026, noon UTC.
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
    user: { id: 'u1', role: 'EMPLOYEE', employee: { id: 'emp-1' } },
    hasRole: jest.fn().mockReturnValue(false),
  };
  mockWeek(emptyWeek);
  projects.loggable.mockResolvedValue({ data: loggable } as any);
});

const waitLoaded = () => screen.findByLabelText('Add row');

describe('Timesheets page', () => {
  it("defaults to this week's Monday and loads the week and loggable projects", async () => {
    render(<TimesheetsPage />);
    await waitLoaded();
    expect(ts.getMyWeek).toHaveBeenCalledWith(WEEK);
    expect(projects.loggable).toHaveBeenCalledWith(WEEK);
    expect(screen.getByLabelText('Week of')).toHaveValue(WEEK);
  });

  it('moves to the next week', async () => {
    render(<TimesheetsPage />);
    await waitLoaded();
    fireEvent.click(screen.getByRole('button', { name: /next week/i }));
    await waitFor(() => expect(ts.getMyWeek).toHaveBeenCalledWith('2026-03-23'));
  });

  it('snaps a picked date to its Monday', async () => {
    render(<TimesheetsPage />);
    await waitLoaded();
    fireEvent.change(screen.getByLabelText('Week of'), { target: { value: '2026-03-25' } });
    await waitFor(() => expect(ts.getMyWeek).toHaveBeenCalledWith('2026-03-23'));
  });

  it('shows an empty state until a row is added', async () => {
    render(<TimesheetsPage />);
    await waitLoaded();
    expect(screen.getByText(/add a project/i)).toBeInTheDocument();
  });

  it('lists the loggable projects and tasks under Add row', async () => {
    render(<TimesheetsPage />);
    const select = await waitLoaded();
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('ALPHA - Alpha');
    expect(options).toContain('BETA - Beta / Build');
    // A project that has tasks can only be picked through a task.
    expect(options).not.toContain('BETA - Beta');
  });

  it('saves a typed cell with the row and day it belongs to', async () => {
    ts.saveEntries.mockResolvedValue({ data: savedWeek('DRAFT') } as any);
    render(<TimesheetsPage />);
    const select = await waitLoaded();

    fireEvent.change(select, { target: { value: 'p1|' } });
    fireEvent.change(screen.getByLabelText('Hours ALPHA Mon 16'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() =>
      expect(ts.saveEntries).toHaveBeenCalledWith(WEEK, [
        { date: WEEK, projectId: 'p1', taskId: null, hours: 4, note: null },
      ]),
    );
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('sends the task and the row note, and skips empty cells', async () => {
    ts.saveEntries.mockResolvedValue({ data: savedWeek('DRAFT') } as any);
    render(<TimesheetsPage />);
    const select = await waitLoaded();

    fireEvent.change(select, { target: { value: 'p2|t1' } });
    fireEvent.change(screen.getByLabelText('Hours BETA / Build Mon 16'), {
      target: { value: '3.5' },
    });
    fireEvent.change(screen.getByLabelText('Hours BETA / Build Tue 17'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('Note BETA / Build'), { target: { value: 'api work' } });
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() =>
      expect(ts.saveEntries).toHaveBeenCalledWith(WEEK, [
        { date: WEEK, projectId: 'p2', taskId: 't1', hours: 3.5, note: 'api work' },
      ]),
    );
  });

  it('disables days outside the project membership window', async () => {
    render(<TimesheetsPage />);
    const select = await waitLoaded();
    fireEvent.change(select, { target: { value: 'p2|t1' } });
    expect(screen.getByLabelText('Hours BETA / Build Tue 17')).not.toBeDisabled();
    expect(screen.getByLabelText('Hours BETA / Build Wed 18')).toBeDisabled();
  });

  it('updates row, column and grand totals as hours are typed', async () => {
    render(<TimesheetsPage />);
    const select = await waitLoaded();
    fireEvent.change(select, { target: { value: 'p1|' } });

    fireEvent.change(screen.getByLabelText('Hours ALPHA Mon 16'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Hours ALPHA Tue 17'), { target: { value: '2.5' } });

    expect(screen.getByTestId('row-total-p1|')).toHaveTextContent('6.5');
    expect(screen.getByTestId('col-total-2026-03-16')).toHaveTextContent('4');
    expect(screen.getByTestId('col-total-2026-03-17')).toHaveTextContent('2.5');
    expect(screen.getByTestId('grand-total')).toHaveTextContent('6.5');
  });

  it('shows attended hours for reference', async () => {
    mockWeek({ ...emptyWeek, attendedMinutesByDate: { [WEEK]: 450 } });
    render(<TimesheetsPage />);
    await waitLoaded();
    expect(screen.getByTestId(`attended-${WEEK}`)).toHaveTextContent('7.5');
    expect(screen.getByTestId('attended-2026-03-17')).toHaveTextContent('-');
  });

  it('builds rows from a saved timesheet', async () => {
    mockWeek(savedWeek('DRAFT'));
    render(<TimesheetsPage />);
    expect(await screen.findByLabelText('Hours ALPHA Mon 16')).toHaveValue('8');
    expect(screen.getByLabelText('Note ALPHA')).toHaveValue('sprint work');
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });

  it('submits a saved draft with its id', async () => {
    mockWeek(savedWeek('DRAFT'));
    ts.submit.mockResolvedValue({ data: {} } as any);
    render(<TimesheetsPage />);
    await screen.findByLabelText('Hours ALPHA Mon 16');

    fireEvent.click(screen.getByRole('button', { name: /^submit/i }));

    await waitFor(() => expect(ts.submit).toHaveBeenCalledWith('ts-1'));
    expect(ts.saveEntries).not.toHaveBeenCalled();
  });

  it('saves unsaved edits first, then submits the saved timesheet', async () => {
    mockWeek(savedWeek('DRAFT'));
    ts.saveEntries.mockResolvedValue({ data: savedWeek('DRAFT', { id: 'ts-9' }) } as any);
    ts.submit.mockResolvedValue({ data: {} } as any);
    render(<TimesheetsPage />);
    const cell = await screen.findByLabelText('Hours ALPHA Mon 16');

    fireEvent.change(cell, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit/i }));

    await waitFor(() => expect(ts.submit).toHaveBeenCalledWith('ts-9'));
    expect(ts.saveEntries).toHaveBeenCalledWith(WEEK, [
      { date: WEEK, projectId: 'p1', taskId: null, hours: 6, note: 'sprint work' },
    ]);
  });

  it('will not submit an empty week', async () => {
    render(<TimesheetsPage />);
    await waitLoaded();
    fireEvent.click(screen.getByRole('button', { name: /^submit/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(ts.submit).not.toHaveBeenCalled();
  });

  it('is read-only when SUBMITTED and offers Recall', async () => {
    mockWeek(savedWeek('SUBMITTED'));
    ts.recall.mockResolvedValue({ data: {} } as any);
    render(<TimesheetsPage />);

    expect(await screen.findByLabelText('Hours ALPHA Mon 16')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^submit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add row')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /recall/i }));
    await waitFor(() => expect(ts.recall).toHaveBeenCalledWith('ts-1'));
  });

  it('is read-only when APPROVED, with no actions', async () => {
    mockWeek(savedWeek('APPROVED'));
    render(<TimesheetsPage />);
    expect(await screen.findByLabelText('Hours ALPHA Mon 16')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /recall/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^submit/i })).not.toBeInTheDocument();
  });

  it('shows the approver note when REJECTED and stays editable', async () => {
    mockWeek(savedWeek('REJECTED', { approverNote: 'Please split the hours by task' }));
    render(<TimesheetsPage />);
    expect(await screen.findByText(/Please split the hours by task/)).toBeInTheDocument();
    expect(screen.getByLabelText('Hours ALPHA Mon 16')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /^submit/i })).toBeInTheDocument();
  });

  it('surfaces a server validation error on save', async () => {
    ts.saveEntries.mockRejectedValue({
      response: { data: { message: 'You are not a member of project ALPHA on 2026-03-16' } },
    });
    render(<TimesheetsPage />);
    const select = await waitLoaded();
    fireEvent.change(select, { target: { value: 'p1|' } });
    fireEvent.change(screen.getByLabelText('Hours ALPHA Mon 16'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        'You are not a member of project ALPHA on 2026-03-16',
      ),
    );
  });

  it('shows an error state with a retry when the week fails to load', async () => {
    ts.getMyWeek.mockRejectedValueOnce(new Error('boom'));
    render(<TimesheetsPage />);
    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();

    mockWeek(emptyWeek);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitLoaded();
    expect(ts.getMyWeek).toHaveBeenCalledTimes(2);
  });

  it('explains when the user has no employee record, without calling the API', async () => {
    mockAuth = { user: { id: 'u1', role: 'SUPER_ADMIN' }, hasRole: jest.fn() };
    render(<TimesheetsPage />);
    expect(await screen.findByText(/no employee record/i)).toBeInTheDocument();
    expect(ts.getMyWeek).not.toHaveBeenCalled();
  });
});
