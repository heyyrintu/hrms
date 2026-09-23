import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ShiftsAdminPage from './page';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

jest.mock('@/lib/api', () => ({
  shiftsApi: {
    getAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    getAssignments: jest.fn(),
    assignShift: jest.fn(),
  },
  employeesApi: { getAll: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { shiftsApi, employeesApi } = require('@/lib/api');

const dayShift = {
  id: 's-day',
  name: 'General',
  code: 'GEN',
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: 60,
  standardWorkMinutes: 480,
  graceMinutes: 15,
  isOvernight: false,
  isActive: true,
};

// Stored before the column existed, so the flag is false; the times win.
const nightShift = {
  ...dayShift,
  id: 's-night',
  name: 'Night',
  code: 'NGT',
  startTime: '22:00',
  endTime: '06:00',
  isOvernight: false,
};

describe('ShiftsAdminPage overnight shifts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shiftsApi.getAll.mockResolvedValue({ data: [dayShift, nightShift] });
    shiftsApi.create.mockResolvedValue({ data: {} });
    shiftsApi.getAssignments.mockResolvedValue({ data: [] });
    employeesApi.getAll.mockResolvedValue({ data: [] });
  });

  it('badges a shift that ends the next day, and only that one', async () => {
    render(<ShiftsAdminPage />);

    await waitFor(() => expect(screen.getByText('Night')).toBeInTheDocument());
    expect(screen.getAllByText('Overnight')).toHaveLength(1);
  });

  it('tells the admin when the times entered cross midnight', async () => {
    render(<ShiftsAdminPage />);
    await waitFor(() => expect(screen.getByText('Night')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add shift/i }));
    // Default form is 09:00-18:00.
    expect(screen.queryByText(/ends the next day/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Start Time *'), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText('End Time *'), { target: { value: '06:00' } });

    expect(screen.getByText(/ends the next day/i)).toBeInTheDocument();
  });

  it('does not send isOvernight, which the server derives from the times', async () => {
    render(<ShiftsAdminPage />);
    await waitFor(() => expect(screen.getByText('Night')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add shift/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g., Morning Shift'), {
      target: { value: 'Late' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g., MS'), { target: { value: 'LT' } });
    fireEvent.change(screen.getByLabelText('End Time *'), { target: { value: '02:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(shiftsApi.create).toHaveBeenCalled());
    const payload = shiftsApi.create.mock.calls[0][0];
    expect(payload).toMatchObject({ startTime: '09:00', endTime: '02:00' });
    expect(payload).not.toHaveProperty('isOvernight');
  });
});
