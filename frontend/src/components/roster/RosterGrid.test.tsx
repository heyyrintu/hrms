import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RosterGrid } from './RosterGrid';
import type { RosterGrid as RosterGridData } from '@/lib/api-roster';
import type { Shift } from '@/lib/api-shifts';

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

const shifts: Shift[] = [
  {
    id: 's-gen',
    name: 'General',
    code: 'GEN',
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 60,
    standardWorkMinutes: 480,
    graceMinutes: 15,
    isOvernight: false,
    isActive: true,
  },
  {
    id: 's-ngt',
    name: 'Night',
    code: 'NGT',
    startTime: '22:00',
    endTime: '06:00',
    breakMinutes: 30,
    standardWorkMinutes: 480,
    graceMinutes: 15,
    isOvernight: true,
    isActive: true,
  },
];

const grid: RosterGridData = {
  days: ['2026-03-16', '2026-03-17', '2026-03-18'],
  rows: [
    {
      employee: { id: 'e1', name: 'Asha Rao', code: 'EMP001', department: 'Ops' },
      cells: [
        {
          date: '2026-03-16',
          shiftId: 's-ngt',
          shiftCode: 'NGT',
          shiftName: 'Night',
          isOvernight: true,
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
        {
          date: '2026-03-18',
          shiftId: 's-gen',
          shiftCode: 'GEN',
          shiftName: 'General',
          isOvernight: false,
          isOff: false,
          source: 'ASSIGNMENT',
        },
      ],
    },
    {
      employee: { id: 'e2', name: 'Ben Das', code: 'EMP002', department: null },
      cells: ['2026-03-16', '2026-03-17', '2026-03-18'].map((date) => ({
        date,
        shiftId: null,
        shiftCode: null,
        shiftName: null,
        isOvernight: false,
        isOff: false,
        source: 'NONE' as const,
      })),
    },
  ],
};

describe('RosterGrid', () => {
  it('renders a row per employee with shift code, OFF or a dash', () => {
    render(<RosterGrid grid={grid} shifts={shifts} editable={false} />);

    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Ben Das')).toBeInTheDocument();
    expect(screen.getByTestId('cell-e1-2026-03-16')).toHaveTextContent('NGT');
    expect(screen.getByTestId('cell-e1-2026-03-16')).toHaveTextContent('\u{1F319}');
    expect(screen.getByTestId('cell-e1-2026-03-17')).toHaveTextContent('OFF');
    expect(screen.getByTestId('cell-e2-2026-03-16')).toHaveTextContent('—');
  });

  it('mutes cells that come from an assignment and not from the roster', () => {
    render(<RosterGrid grid={grid} shifts={shifts} editable={false} />);

    expect(screen.getByTestId('cell-e1-2026-03-18').className).toContain('opacity-60');
    expect(screen.getByTestId('cell-e1-2026-03-16').className).not.toContain('opacity-60');
  });

  it('is read-only when not editable', () => {
    render(<RosterGrid grid={grid} shifts={shifts} editable={false} />);

    fireEvent.click(screen.getByTestId('cell-e1-2026-03-16'));
    expect(screen.queryByTestId('pick-off')).not.toBeInTheDocument();
    expect(screen.queryByText(/Save \(/)).not.toBeInTheDocument();
  });

  it('shows an empty state with no rows', () => {
    render(<RosterGrid grid={{ days: [], rows: [] }} shifts={shifts} editable={false} />);
    expect(screen.getByText('No employees to show.')).toBeInTheDocument();
  });

  it('picks OFF, marks the cell dirty and saves it', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<RosterGrid grid={grid} shifts={shifts} editable onSave={onSave} />);

    expect(screen.queryByText(/Save \(/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cell-e2-2026-03-17'));
    fireEvent.click(screen.getByTestId('pick-off'));

    expect(screen.getByTestId('cell-e2-2026-03-17')).toHaveTextContent('OFF');
    fireEvent.click(screen.getByText('Save (1)'));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([{ employeeId: 'e2', date: '2026-03-17', isOff: true }]),
    );
    await waitFor(() => expect(screen.queryByText(/Save \(/)).not.toBeInTheDocument());
  });

  it('batches a shift pick and a clear into one save', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<RosterGrid grid={grid} shifts={shifts} editable onSave={onSave} />);

    fireEvent.click(screen.getByTestId('cell-e2-2026-03-16'));
    fireEvent.click(screen.getByTestId('pick-shift-s-gen'));
    fireEvent.click(screen.getByTestId('cell-e1-2026-03-17'));
    fireEvent.click(screen.getByTestId('pick-clear'));

    expect(screen.getByTestId('cell-e2-2026-03-16')).toHaveTextContent('GEN');
    fireEvent.click(screen.getByText('Save (2)'));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        { employeeId: 'e2', date: '2026-03-16', shiftId: 's-gen' },
        { employeeId: 'e1', date: '2026-03-17', clear: true },
      ]),
    );
  });

  it('keeps the edits when saving fails', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('nope'));
    render(<RosterGrid grid={grid} shifts={shifts} editable onSave={onSave} />);

    fireEvent.click(screen.getByTestId('cell-e2-2026-03-17'));
    fireEvent.click(screen.getByTestId('pick-off'));
    fireEvent.click(screen.getByText('Save (1)'));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(await screen.findByText('Save (1)')).toBeInTheDocument();
  });

  it('discards pending edits', () => {
    render(<RosterGrid grid={grid} shifts={shifts} editable onSave={jest.fn()} />);

    fireEvent.click(screen.getByTestId('cell-e2-2026-03-17'));
    fireEvent.click(screen.getByTestId('pick-off'));
    fireEvent.click(screen.getByText('Discard'));

    expect(screen.queryByText(/Save \(/)).not.toBeInTheDocument();
    expect(screen.getByTestId('cell-e2-2026-03-17')).toHaveTextContent('—');
  });
});
