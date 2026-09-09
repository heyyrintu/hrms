import React from 'react';
import { render, screen } from '@testing-library/react';
import PayrollLayout from './layout';

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

const auth = { isAdmin: false, isLoading: false };
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => auth,
}));

describe('PayrollLayout', () => {
    beforeEach(() => {
        auth.isAdmin = false;
        auth.isLoading = false;
    });

    it('keeps company salary figures away from an employee who types the URL', () => {
        render(
            <PayrollLayout>
                <p>Everyone&apos;s net pay</p>
            </PayrollLayout>,
        );

        expect(screen.queryByText("Everyone's net pay")).not.toBeInTheDocument();
        expect(
            screen.getByText('You do not have access to this page'),
        ).toBeInTheDocument();
    });

    it('points the refused employee at the pages that are theirs', () => {
        render(<PayrollLayout><p>hidden</p></PayrollLayout>);

        // A dead end invites a support ticket. Name where their own payslips and
        // certificate actually live.
        expect(screen.getByText(/My Payslips/)).toBeInTheDocument();
        expect(screen.getByText(/My Form 16/)).toBeInTheDocument();
    });

    it('renders the page for an HR administrator', () => {
        auth.isAdmin = true;

        render(<PayrollLayout><p>Everyone&apos;s net pay</p></PayrollLayout>);

        expect(screen.getByText("Everyone's net pay")).toBeInTheDocument();
        expect(
            screen.queryByText('You do not have access to this page'),
        ).not.toBeInTheDocument();
    });

    it('waits rather than refusing while the session is still loading', () => {
        auth.isLoading = true;

        render(<PayrollLayout><p>Everyone&apos;s net pay</p></PayrollLayout>);

        // Refusing during the load would flash "no access" at an administrator
        // on every hard refresh.
        expect(
            screen.queryByText('You do not have access to this page'),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("Everyone's net pay")).not.toBeInTheDocument();
    });
});
