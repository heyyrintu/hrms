import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import SsoButtons from './SsoButtons';
import { ssoApi } from '@/lib/api-security';

jest.mock('@/lib/api-security', () => ({
  ssoApi: {
    providers: jest.fn(),
    startUrl: jest.fn(
      (provider: string, org?: string | null) =>
        `http://localhost:3001/api/auth/sso/${provider.toLowerCase()}/start${org ? `?org=${org}` : ''}`,
    ),
  },
}));

describe('SsoButtons', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing while loading and stays empty when there are no providers', async () => {
    (ssoApi.providers as jest.Mock).mockResolvedValue({ data: { providers: [], requireSso: false } });
    const { container } = render(<SsoButtons org={null} />);

    await waitFor(() => expect(ssoApi.providers).toHaveBeenCalledWith(null));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the providers call fails', async () => {
    (ssoApi.providers as jest.Mock).mockRejectedValue(new Error('network error'));
    const { container } = render(<SsoButtons org="acme" />);

    await waitFor(() => expect(ssoApi.providers).toHaveBeenCalledWith('acme'));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a "Continue with" link per enabled provider, pointed at the start URL', async () => {
    (ssoApi.providers as jest.Mock).mockResolvedValue({
      data: { providers: ['GOOGLE', 'MICROSOFT'], requireSso: false },
    });

    render(<SsoButtons org="acme" />);

    const google = await screen.findByRole('link', { name: /continue with google/i });
    expect(google).toHaveAttribute('href', 'http://localhost:3001/api/auth/sso/google/start?org=acme');

    const microsoft = screen.getByRole('link', { name: /continue with microsoft/i });
    expect(microsoft).toHaveAttribute(
      'href',
      'http://localhost:3001/api/auth/sso/microsoft/start?org=acme',
    );
  });

  it('reports the loaded providers and requireSso through onProviders', async () => {
    const onProviders = jest.fn();
    (ssoApi.providers as jest.Mock).mockResolvedValue({
      data: { providers: ['GOOGLE'], requireSso: true },
    });

    render(<SsoButtons org={null} onProviders={onProviders} />);

    await waitFor(() =>
      expect(onProviders).toHaveBeenCalledWith({ providers: ['GOOGLE'], requireSso: true }),
    );
  });
});
