import React from 'react';
import { render, screen } from '@testing-library/react';
import { ApprovalTrail } from './ApprovalTrail';

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

jest.mock('@/lib/api-workflow', () => {
  const actual = jest.requireActual('@/lib/api-workflow');
  return { ...actual, workflowApi: { getTrail: jest.fn() } };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { workflowApi } = require('@/lib/api-workflow');

const trail = {
  instanceId: 'inst-1',
  status: 'REJECTED',
  round: 2,
  currentStepOrder: 2,
  canAct: false,
  steps: [
    {
      order: 1,
      name: 'Manager',
      approverType: 'REPORTING_MANAGER',
      state: 'APPROVED',
      actedBy: { userId: 'u-2', name: 'Deepa Nair' },
      onBehalfOf: { userId: 'u-1', name: 'Arjun Rao' },
      isOverride: false,
      actedAt: '2026-10-01T12:00:00Z',
      note: 'Fine by me',
    },
    {
      order: 2,
      name: 'HR',
      approverType: 'HR_ADMIN',
      state: 'REJECTED',
      actedBy: { userId: 'u-9', name: 'Hema Pillai' },
      onBehalfOf: null,
      isOverride: true,
      actedAt: '2026-10-02T12:00:00Z',
      note: null,
    },
  ],
};

describe('ApprovalTrail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches the trail for the entity and renders each step', async () => {
    workflowApi.getTrail.mockResolvedValue({ data: trail });
    render(<ApprovalTrail entityType="EXPENSE" entityId="exp-1" />);

    expect(screen.getByText('Loading approval trail...')).toBeInTheDocument();
    expect(await screen.findByText('1. Manager')).toBeInTheDocument();
    expect(workflowApi.getTrail).toHaveBeenCalledWith('EXPENSE', 'exp-1');

    expect(screen.getByText(/Approved by Deepa Nair on behalf of Arjun Rao/)).toBeInTheDocument();
    expect(screen.getByText(/Rejected by Hema Pillai/)).toBeInTheDocument();
    expect(screen.getByText('Admin override')).toBeInTheDocument();
    expect(screen.getByText(/Fine by me/)).toBeInTheDocument();
    expect(screen.getByText('Round 2')).toBeInTheDocument();
  });

  it('says so when there is no trail yet', async () => {
    workflowApi.getTrail.mockRejectedValue({ response: { status: 404 } });
    render(<ApprovalTrail entityType="LEAVE" entityId="l-1" />);
    expect(
      await screen.findByText('No approval trail for this request yet.'),
    ).toBeInTheDocument();
  });

  it('shows the API message for other failures', async () => {
    workflowApi.getTrail.mockRejectedValue({
      response: { status: 403, data: { message: 'Not your request' } },
    });
    render(<ApprovalTrail entityType="LEAVE" entityId="l-1" />);
    expect(await screen.findByText('Not your request')).toBeInTheDocument();
  });
});
