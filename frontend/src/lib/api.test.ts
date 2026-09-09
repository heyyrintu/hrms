/** @jest-environment node */
import { AxiosError, AxiosHeaders } from 'axios';
import { api, authApi } from './api';

describe('API authentication errors', () => {
  let storage: Map<string, string>;
  const replace = jest.fn();
  const location = { pathname: '/dashboard', replace };

  beforeEach(() => {
    storage = new Map([['hrms_token', 'current-token'], ['hrms_user', '{}']]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
      },
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
    location.pathname = '/dashboard';
    replace.mockClear();
    api.defaults.adapter = async (config) => {
      throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
        status: 401, statusText: 'Unauthorized', config,
        headers: new AxiosHeaders(), data: { message: 'Invalid credentials' },
      });
    };
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('returns rejected login to the form without clearing a session or navigating', async () => {
    await expect(authApi.login('wrong@example.com', 'wrong')).rejects.toMatchObject({
      response: { status: 401, data: { message: 'Invalid credentials' } },
    });
    expect(replace).not.toHaveBeenCalled();
    expect(storage.get('hrms_token')).toBe('current-token');
  });

  it('clears an expired session and redirects only once for concurrent failures', async () => {
    await Promise.allSettled([authApi.getProfile(), api.get('/notifications')]);
    expect(storage.size).toBe(0);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('does not reload the login page when stored credentials expire', async () => {
    location.pathname = '/login';
    await expect(authApi.getProfile()).rejects.toMatchObject({ response: { status: 401 } });
    expect(storage.size).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not redirect unauthenticated requests', async () => {
    storage.clear();
    await expect(authApi.getProfile()).rejects.toMatchObject({ response: { status: 401 } });
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not clear a new session when an old request fails', async () => {
    const rejectRequest = api.defaults.adapter as (config: any) => Promise<never>;
    api.defaults.adapter = async (config) => {
      storage.set('hrms_token', 'new-token');
      return rejectRequest(config);
    };
    await expect(authApi.getProfile()).rejects.toMatchObject({ response: { status: 401 } });
    expect(storage.get('hrms_token')).toBe('new-token');
    expect(replace).not.toHaveBeenCalled();
  });
});
