import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GoalTree } from './GoalTree';
import { GoalFormModal } from './GoalFormModal';
import { KeyResultEditor } from './KeyResultEditor';
import { goalsApi } from '@/lib/api-performance-goals';
import type { Goal, GoalTreeNode, KeyResult } from '@/lib/api-performance-goals';

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_t, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

jest.mock('@/lib/api', () => ({
  api: {},
  departmentsApi: { getAll: jest.fn().mockResolvedValue({ data: [{ id: 'd1', name: 'Engineering' }] }) },
}));
jest.mock('@/lib/api-performance-goals', () => ({
  goalsApi: {
    list: jest.fn().mockResolvedValue({ data: [] }),
    updateKeyResult: jest.fn().mockResolvedValue({ data: {} }),
    addKeyResult: jest.fn().mockResolvedValue({ data: {} }),
    removeKeyResult: jest.fn().mockResolvedValue({ data: {} }),
  },
}));
jest.mock('@/lib/api-performance-reviews', () => ({
  reviewsApi: { myReviews: jest.fn().mockResolvedValue({ data: { data: [] } }) },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1', ownerType: 'COMPANY', title: 'Grow revenue', description: null, targetDate: '2026-12-31T00:00:00Z',
  status: 'IN_PROGRESS', progress: 40, weight: 1, shareOnFeed: false, completedAt: null, reviewId: null,
  parentGoalId: null, employeeId: null, departmentId: null, keyResults: [], isDerived: false, canEdit: true, ...over,
});
const node = (over: Partial<GoalTreeNode> = {}): GoalTreeNode => ({ ...goal(), children: [], ...over });
const kr = (over: Partial<KeyResult> = {}): KeyResult => ({
  id: 'k1', goalId: 'g1', title: 'Hit 10 deals', metricType: 'NUMBER', startValue: 0, targetValue: 10,
  currentValue: 2, unit: null, weight: 1, progress: 20, sortOrder: 0, ...over,
});

describe('GoalTree', () => {
  it('renders nested children, owner chips and KR counts, and collapses', () => {
    const tree = [node({
      children: [node({
        id: 'g2', title: 'Dept goal', ownerType: 'DEPARTMENT', department: { id: 'd1', name: 'Engineering' },
        keyResults: [kr(), kr({ id: 'k2' })],
        children: [node({ id: 'g3', title: 'Ann goal', ownerType: 'EMPLOYEE', employee: { id: 'e1', firstName: 'Ann', lastName: 'Lee' } })],
      })],
    })];
    render(<GoalTree nodes={tree} onSelect={jest.fn()} />);
    expect(screen.getByText('Grow revenue')).toBeInTheDocument();
    expect(screen.getByText('Dept goal')).toBeInTheDocument();
    expect(screen.getByText('Ann goal')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
    expect(screen.getByText('2 KRs')).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('Collapse')[0]);
    expect(screen.queryByText('Dept goal')).not.toBeInTheDocument();
  });

  it('calls onSelect when a goal title is clicked', () => {
    const onSelect = jest.fn();
    render(<GoalTree nodes={[node()]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Grow revenue'));
    expect(onSelect).toHaveBeenCalledWith('g1');
  });
});

describe('GoalFormModal', () => {
  const base = { isOpen: true, onClose: jest.fn(), onSave: jest.fn(), goal: null, initialOwnerType: 'EMPLOYEE' as const };

  it('hides the progress input for a derived goal', async () => {
    render(<GoalFormModal {...base} isAdmin goal={goal({ isDerived: true })} />);
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument());
    expect(screen.queryByLabelText('Progress (%)')).not.toBeInTheDocument();
  });

  it('shows the progress input for a non-derived goal', async () => {
    render(<GoalFormModal {...base} isAdmin goal={goal({ isDerived: false })} />);
    await waitFor(() => expect(screen.getByLabelText('Progress (%)')).toBeInTheDocument());
  });

  it('does not offer COMPANY to a non-admin and hides the owner type select', async () => {
    render(<GoalFormModal {...base} isAdmin={false} />);
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeInTheDocument());
    expect(screen.queryByLabelText('Owner type')).not.toBeInTheDocument();
    expect(screen.queryByText('Company')).not.toBeInTheDocument();
  });

  it('offers COMPANY to an admin', async () => {
    render(<GoalFormModal {...base} isAdmin />);
    const select = await screen.findByLabelText('Owner type');
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toContain('COMPANY');
  });
});

describe('KeyResultEditor', () => {
  it('saves an edited key result through updateKeyResult', async () => {
    const onChanged = jest.fn();
    render(<KeyResultEditor goalId="g1" keyResults={[kr()]} canEdit onChanged={onChanged} />);
    fireEvent.click(screen.getByLabelText('Edit key result Hit 10 deals'));
    fireEvent.change(screen.getByLabelText('Current value'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(goalsApi.updateKeyResult).toHaveBeenCalledWith('g1', 'k1', expect.objectContaining({ currentValue: 5 })));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows a done checkbox for BOOLEAN key results', () => {
    render(<KeyResultEditor goalId="g1" keyResults={[kr({ id: 'k9', title: 'Ship it', metricType: 'BOOLEAN', targetValue: 1, currentValue: 0 })]} canEdit onChanged={jest.fn()} />);
    expect(screen.getByLabelText('Done: Ship it')).toBeInTheDocument();
  });
});
