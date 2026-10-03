import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import TemplatesPage from './page';
import { templatesApi } from '@/lib/api-performance-templates';

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

let mockIsAdmin = true;
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', role: mockIsAdmin ? 'HR_ADMIN' : 'EMPLOYEE', employee: { id: 'e1' } },
    isAuthenticated: true,
    isLoading: false,
    hasRole: jest.fn().mockImplementation(() => mockIsAdmin),
  }),
}));

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/api', () => ({
  api: { defaults: { headers: { common: {} } }, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
}));
jest.mock('@/lib/api-performance-templates', () => ({
  templatesApi: {
    listQuestions: jest.fn(), createQuestion: jest.fn(), updateQuestion: jest.fn(), removeQuestion: jest.fn(),
    list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn(),
  },
}));

const api = templatesApi as jest.Mocked<typeof templatesApi>;

const bank = [
  { id: 'q1', text: 'What went well?', type: 'TEXT', category: 'Reflection', isActive: true, usedByTemplates: 0 },
  { id: 'q2', text: 'Rate collaboration', type: 'RATING', category: null, isActive: true, usedByTemplates: 1 },
  { id: 'q3', text: 'Old question', type: 'TEXT', category: null, isActive: false, usedByTemplates: 0 },
];
const template = {
  id: 't1', name: 'Engineering', description: 'For engineers', isActive: true,
  questions: [
    { questionId: 'q1', audience: 'SELF', isRequired: true, sortOrder: 0, question: { id: 'q1', text: 'What went well?', type: 'TEXT', isActive: true } },
    { questionId: 'q2', audience: 'MANAGER', isRequired: false, sortOrder: 1, question: { id: 'q2', text: 'Rate collaboration', type: 'RATING', isActive: true } },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAdmin = true;
  api.listQuestions.mockResolvedValue({ data: bank } as never);
  api.list.mockResolvedValue({ data: [template] } as never);
});

describe('TemplatesPage', () => {
  it('is admin-only', async () => {
    mockIsAdmin = false;
    render(<TemplatesPage />);
    expect(await screen.findByText(/only available to HR administrators/)).toBeInTheDocument();
    expect(api.listQuestions).not.toHaveBeenCalled();
  });

  it('lists the question bank', async () => {
    render(<TemplatesPage />);
    expect(await screen.findByText('What went well?')).toBeInTheDocument();
    expect(screen.getByText('Rate collaboration')).toBeInTheDocument();
    expect(screen.getByText('Reflection')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('adds a question', async () => {
    api.createQuestion.mockResolvedValue({ data: bank[0] } as never);
    render(<TemplatesPage />);
    await screen.findByText('What went well?');
    fireEvent.click(screen.getByRole('button', { name: /Add question/ }));
    fireEvent.change(screen.getByLabelText('Question text'), { target: { value: 'How did you grow?' } });
    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'RATING' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Growth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save question' }));
    await waitFor(() =>
      expect(api.createQuestion).toHaveBeenCalledWith({ text: 'How did you grow?', type: 'RATING', category: 'Growth' }),
    );
  });

  it('deactivates and deletes questions, blocking delete of one used by a template', async () => {
    api.updateQuestion.mockResolvedValue({ data: bank[0] } as never);
    api.removeQuestion.mockResolvedValue({} as never);
    render(<TemplatesPage />);
    await screen.findByText('What went well?');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate What went well?' }));
    await waitFor(() => expect(api.updateQuestion).toHaveBeenCalledWith('q1', { isActive: false }));

    expect(screen.getByRole('button', { name: 'Delete Rate collaboration' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete What went well?' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(api.removeQuestion).toHaveBeenCalledWith('q1'));
  });

  it('edits a template: reorders and removes entries, then saves with sortOrder', async () => {
    api.update.mockResolvedValue({ data: template } as never);
    render(<TemplatesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Templates' }));
    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Engineering' }));

    const editor = await screen.findByRole('dialog');
    fireEvent.click(within(editor).getByRole('button', { name: 'Move entry 2 up' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith('t1', {
      name: 'Engineering',
      description: 'For engineers',
      isActive: true,
      questions: [
        { questionId: 'q2', audience: 'MANAGER', isRequired: false, sortOrder: 0 },
        { questionId: 'q1', audience: 'SELF', isRequired: true, sortOrder: 1 },
      ],
    });
  });

  it('creates a template from active bank questions only', async () => {
    api.create.mockResolvedValue({ data: template } as never);
    render(<TemplatesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Templates' }));
    await screen.findByText('Engineering');
    fireEvent.click(screen.getByRole('button', { name: /New template/ }));
    const editor = await screen.findByRole('dialog');
    fireEvent.change(within(editor).getByLabelText('Template name'), { target: { value: 'Sales' } });
    fireEvent.click(within(editor).getByRole('button', { name: /Add entry/ }));
    const select = within(editor).getByLabelText('Entry 1 question');
    expect(within(select).queryByRole('option', { name: /Old question/ })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'q2' } });
    fireEvent.change(within(editor).getByLabelText('Entry 1 audience'), { target: { value: 'PEER' } });
    fireEvent.click(within(editor).getByLabelText('Entry 1 required'));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        name: 'Sales',
        description: undefined,
        isActive: true,
        questions: [{ questionId: 'q2', audience: 'PEER', isRequired: false, sortOrder: 0 }],
      }),
    );
  });

  it('removes an entry from the editor', async () => {
    api.update.mockResolvedValue({ data: template } as never);
    render(<TemplatesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Templates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Engineering' }));
    const editor = await screen.findByRole('dialog');
    fireEvent.click(within(editor).getByRole('button', { name: 'Remove entry 1' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect((api.update.mock.calls[0][1] as { questions: unknown[] }).questions).toEqual([
      { questionId: 'q2', audience: 'MANAGER', isRequired: false, sortOrder: 0 },
    ]);
  });

  it('shows a load error with Retry on the question bank', async () => {
    api.listQuestions.mockRejectedValueOnce(new Error('boom'));
    render(<TemplatesPage />);
    expect(await screen.findByText('Failed to load the question bank.')).toBeInTheDocument();
    expect(screen.queryByText('No questions yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('What went well?')).toBeInTheDocument();
  });

  it('shows a load error with Retry on the templates tab', async () => {
    api.list.mockRejectedValueOnce(new Error('boom'));
    render(<TemplatesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Templates' }));
    expect(await screen.findByText('Failed to load templates.')).toBeInTheDocument();
    expect(screen.queryByText('No templates yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Engineering')).toBeInTheDocument();
  });
});
