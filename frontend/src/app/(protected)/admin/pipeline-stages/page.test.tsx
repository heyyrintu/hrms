import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PipelineStagesPage from './page';
import { recruitmentApi } from '@/lib/api-recruitment';

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

jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock('@/components/ui/Select', () => ({
  Select: ({ options, ...props }: any) => (
    <select {...props}>
      {options?.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

jest.mock('@/lib/api-recruitment', () => ({
  recruitmentApi: {
    listStages: jest.fn(),
    replaceStages: jest.fn(),
  },
}));

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

const mockedApi = recruitmentApi as unknown as {
  listStages: jest.Mock;
  replaceStages: jest.Mock;
};

const stages = [
  { id: 's1', name: 'Applied', sortOrder: 1, category: 'APPLIED', isActive: true },
  { id: 's2', name: 'Screening', sortOrder: 2, category: 'SCREENING', isActive: true },
  { id: 's3', name: 'Old Round', sortOrder: 3, category: 'INTERVIEW', isActive: false },
];

describe('PipelineStagesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.listStages.mockResolvedValue({ data: stages });
    mockedApi.replaceStages.mockResolvedValue({ data: stages.filter((s) => s.isActive) });
  });

  it('loads and renders active stages and the inactive history section', async () => {
    render(<PipelineStagesPage />);

    expect(await screen.findByLabelText('Stage 1 name')).toHaveValue('Applied');
    expect(screen.getByLabelText('Stage 2 name')).toHaveValue('Screening');
    expect(screen.getByText('Old Round')).toBeInTheDocument();
  });

  it('adds a new stage row', async () => {
    render(<PipelineStagesPage />);
    await screen.findByLabelText('Stage 1 name');

    fireEvent.click(screen.getByText('Add stage'));

    expect(await screen.findByLabelText('Stage 3 name')).toHaveValue('New stage');
  });

  it('saves the active stages via PUT', async () => {
    render(<PipelineStagesPage />);
    await screen.findByLabelText('Stage 1 name');

    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() =>
      expect(mockedApi.replaceStages).toHaveBeenCalledWith([
        { id: 's1', name: 'Applied', category: 'APPLIED' },
        { id: 's2', name: 'Screening', category: 'SCREENING' },
      ]),
    );
  });

  it('moves the deactivated stage to the inactive list when removed', async () => {
    render(<PipelineStagesPage />);
    await screen.findByLabelText('Stage 1 name');

    const removeButtons = screen.getAllByLabelText(/Remove stage/);
    fireEvent.click(removeButtons[1]);

    const remainingNames = screen.getAllByLabelText(/Stage \d name/);
    expect(remainingNames).toHaveLength(1);
    expect(remainingNames[0]).toHaveValue('Applied');
  });
});
