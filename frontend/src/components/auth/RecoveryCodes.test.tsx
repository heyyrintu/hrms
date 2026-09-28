import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecoveryCodes from './RecoveryCodes';

describe('RecoveryCodes', () => {
  const codes = ['AAAAA-BBBBB', 'CCCCC-DDDDD'];
  const onContinue = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists every code', () => {
    render(<RecoveryCodes codes={codes} onContinue={onContinue} />);
    for (const code of codes) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it('disables Continue until the checkbox is checked, then calls onContinue', async () => {
    const user = userEvent.setup();
    render(<RecoveryCodes codes={codes} onContinue={onContinue} />);

    const continueButton = screen.getByRole('button', { name: /continue/i });
    expect(continueButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /i have saved these codes/i }));
    expect(continueButton).not.toBeDisabled();

    await user.click(continueButton);
    expect(onContinue).toHaveBeenCalled();
  });

  it('offers a download of the codes as a .txt file', async () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:mock');
    const revokeObjectURL = jest.fn();
    (global.URL as any).createObjectURL = createObjectURL;
    (global.URL as any).revokeObjectURL = revokeObjectURL;
    const user = userEvent.setup();

    render(<RecoveryCodes codes={codes} onContinue={onContinue} />);
    await user.click(screen.getByRole('button', { name: /download/i }));

    expect(createObjectURL).toHaveBeenCalled();
  });
});
