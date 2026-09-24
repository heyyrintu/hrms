import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalNoteDialog } from './ApprovalNoteDialog';

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

describe('ApprovalNoteDialog', () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it('lets the note be left blank by default', () => {
    render(
      <ApprovalNoteDialog isOpen decision="reject" onCancel={onCancel} onConfirm={onConfirm} />,
    );

    expect(screen.getByLabelText('Note (optional)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('with requireNote, labels the note as a required reason and blocks a blank one', () => {
    render(
      <ApprovalNoteDialog
        isOpen
        decision="reject"
        requireNote
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    const note = screen.getByLabelText('Reason (required)');
    const confirm = screen.getByRole('button', { name: 'Confirm reject' });
    expect(note).toBeRequired();
    expect(confirm).toBeDisabled();

    fireEvent.change(note, { target: { value: '  ' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(note, { target: { value: 'Over the limit' } });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Over the limit');
  });
});
