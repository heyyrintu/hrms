import React from 'react';
import { render, screen } from '@testing-library/react';
import SettlementsLayout from './layout';
import { usePathname } from 'next/navigation';

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

jest.mock('next/navigation', () => ({ usePathname: jest.fn() }));
const mockedUsePathname = usePathname as unknown as jest.Mock;

const auth: { isAdmin: boolean; isLoading: boolean; hasPermission: (key?: string) => boolean } = {
    isAdmin: false,
    isLoading: false,
    hasPermission: () => false,
};
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => auth,
}));

describe('SettlementsLayout', () => {
    beforeEach(() => {
        auth.isAdmin = false;
        auth.isLoading = false;
        auth.hasPermission = () => false;
        mockedUsePathname.mockReturnValue('/settlements');
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

    // I5: a custom-role EMPLOYEE holding exit.manage was getting the same
    // "no access" wall as anyone else, because the gate only ever checked
    // isAdmin — mirrors AdminLayout's isAdmin || hasPermission(...) check.
    it('lets an EMPLOYEE with exit.manage through, like AdminLayout does for its permission-covered paths', () => {
        auth.hasPermission = (key?: string) => key === 'exit.manage';

        render(<SettlementsLayout><p>Gratuity payable</p></SettlementsLayout>);

        expect(screen.getByText('Gratuity payable')).toBeInTheDocument();
        expect(
            screen.queryByText('You do not have access to this page'),
        ).not.toBeInTheDocument();
    });

    it('still refuses an EMPLOYEE without exit.manage', () => {
        auth.hasPermission = (key?: string) => key === 'some.other.permission';

        render(<SettlementsLayout><p>Gratuity payable</p></SettlementsLayout>);

        expect(screen.queryByText('Gratuity payable')).not.toBeInTheDocument();
        expect(
            screen.getByText('You do not have access to this page'),
        ).toBeInTheDocument();
    });
});
