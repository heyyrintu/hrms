import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SurveysPage from './page';
import { surveysApi } from '@/lib/api-surveys';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';

jest.mock('@/lib/api-surveys', () => ({
  surveysApi: {
    mine: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    launch: jest.fn(),
    close: jest.fn(),
  },
}));

jest.mock('@/lib/api', () => ({
  departmentsApi: { getAll: jest.fn().mockResolvedValue({ data: [] }) },
  branchesApi: { getAll: jest.fn().mockResolvedValue({ data: [] }) },
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

describe('SurveysPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (surveysApi.mine as jest.Mock).mockResolvedValue({
      data: [
        { id: 's-1', title: 'Open survey', questionCount: 3, submitted: false, isOpen: true, isAnonymous: false, status: 'ACTIVE' },
        { id: 's-2', title: 'Answered survey', questionCount: 2, submitted: true, isOpen: true, isAnonymous: false, status: 'ACTIVE' },
      ],
    });
    (surveysApi.list as jest.Mock).mockResolvedValue({ data: { data: [] } });
  });

  it('renders open and responded surveys in "My surveys"', async () => {
    (useAuth as jest.Mock).mockReturnValue({ hasRole: () => false });

    render(<SurveysPage />);

    await waitFor(() => expect(screen.getByText('Open survey')).toBeInTheDocument());
    expect(screen.getByText('Answered survey')).toBeInTheDocument();
    expect(screen.getByText('Responded')).toBeInTheDocument();
    expect(screen.getByText('Respond')).toBeInTheDocument();
  });

  it('hides the Manage tab for an EMPLOYEE', async () => {
    (useAuth as jest.Mock).mockReturnValue({
      hasRole: (...roles: UserRole[]) => roles.every((r) => false),
    });

    render(<SurveysPage />);

    await waitFor(() => expect(screen.getByText('My surveys')).toBeInTheDocument());
    expect(screen.queryByText('Manage')).not.toBeInTheDocument();
  });

  it('shows the Manage tab for HR_ADMIN', async () => {
    (useAuth as jest.Mock).mockReturnValue({ hasRole: () => true });

    render(<SurveysPage />);

    await waitFor(() => expect(screen.getByText('Manage')).toBeInTheDocument());
  });

  it('pluralises the question count: 1 question, 2 questions', async () => {
    (useAuth as jest.Mock).mockReturnValue({ hasRole: () => false });
    (surveysApi.mine as jest.Mock).mockResolvedValue({
      data: [
        { id: 's-1', title: 'One', questionCount: 1, submitted: false, isOpen: true, isAnonymous: false, status: 'ACTIVE' },
        { id: 's-2', title: 'Two', questionCount: 2, submitted: false, isOpen: true, isAnonymous: false, status: 'ACTIVE' },
      ],
    });

    render(<SurveysPage />);

    await waitFor(() => expect(screen.getByText('1 question')).toBeInTheDocument());
    expect(screen.getByText('2 questions')).toBeInTheDocument();
    expect(screen.queryByText('1 questions')).not.toBeInTheDocument();
  });

  it('reloads "My surveys" when that tab is re-activated', async () => {
    (useAuth as jest.Mock).mockReturnValue({ hasRole: () => true });

    render(<SurveysPage />);
    await waitFor(() => expect(surveysApi.mine).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Manage'));
    await waitFor(() => expect(surveysApi.list).toHaveBeenCalled());
    expect(surveysApi.mine).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('My surveys'));
    await waitFor(() => expect(surveysApi.mine).toHaveBeenCalledTimes(2));
  });

  it('reloads "My surveys" after launching a survey so it shows up on switching tabs', async () => {
    (useAuth as jest.Mock).mockReturnValue({ hasRole: () => true });
    (surveysApi.list as jest.Mock).mockResolvedValue({
      data: { data: [{ id: 's-9', title: 'Draft one', status: 'DRAFT' }] },
    });
    (surveysApi.launch as jest.Mock).mockResolvedValue({ data: {} });

    render(<SurveysPage />);
    await waitFor(() => expect(surveysApi.mine).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Manage'));
    fireEvent.click(await screen.findByRole('button', { name: 'Launch' }));

    await waitFor(() => expect(surveysApi.launch).toHaveBeenCalledWith('s-9'));
    await waitFor(() => expect(surveysApi.mine).toHaveBeenCalledTimes(2));
  });
});
