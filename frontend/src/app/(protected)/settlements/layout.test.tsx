import React from 'react';
import { render, screen } from '@testing-library/react';
import SettlementsLayout from './layout';

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

describe('SettlementsLayout', () => {
    beforeEach(() => {
        auth.isAdmin = false;
        auth.isLoading = false;
    });

    it('keeps a settlement away from an employee who types the URL', () => {
        render(
            <SettlementsLayout>
                <p>Gratuity payable</p>
            </SettlementsLayout>,
        );

        expect(screen.queryByText('Gratuity payable')).not.toBeInTheDocument();
        expect(
            screen.getByText('You do not have access to this page'),
        ).toBeInTheDocument();
    });

    it('tells the refused employee who to ask instead', () => {
        render(<SettlementsLayout><p>hidden</p></SettlementsLayout>);

        // A dead end invites a support ticket. Name the route that does exist.
        expect(screen.getByText(/ask your HR team/)).toBeInTheDocument();
    });

    it('renders the page for an HR administrator', () => {
        auth.isAdmin = true;

        render(<SettlementsLayout><p>Gratuity payable</p></SettlementsLayout>);

        expect(screen.getByText('Gratuity payable')).toBeInTheDocument();
        expect(
            screen.queryByText('You do not have access to this page'),
        ).not.toBeInTheDocument();
    });

    it('waits rather than refusing while the session is still loading', () => {
        auth.isLoading = true;

        render(<SettlementsLayout><p>Gratuity payable</p></SettlementsLayout>);

        // Refusing during the load would flash "no access" at an administrator
        // on every hard refresh.
        expect(
            screen.queryByText('You do not have access to this page'),
        ).not.toBeInTheDocument();
        expect(screen.queryByText('Gratuity payable')).not.toBeInTheDocument();
    });
});
