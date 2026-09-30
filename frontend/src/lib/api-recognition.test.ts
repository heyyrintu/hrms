/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { recognitionApi } from './api-recognition';

describe('recognition API requests', () => {
  let sent: InternalAxiosRequestConfig[];

  beforeEach(() => {
    sent = [];
    api.defaults.adapter = async (config) => {
      sent.push(config);
      return {
        data: {},
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };
  });

  const body = (i = 0) => (sent[i].data ? JSON.parse(sent[i].data) : undefined);

  it('lists the wall with GET /engagement/recognition and forwards paging params', async () => {
    await recognitionApi.wall({ page: 2, limit: 10, employeeId: 'e-1' });

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/recognition');
    expect(sent[0].params).toEqual({ page: 2, limit: 10, employeeId: 'e-1' });
  });

  it('gives recognition with POST /engagement/recognition', async () => {
    const payload = { recipientIds: ['r-1', 'r-2'], message: 'Great job', badgeId: 'b-1', points: 10 };

    await recognitionApi.give(payload);

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/recognition');
    expect(body()).toEqual(payload);
  });

  it('reads my summary with GET /engagement/recognition/me', async () => {
    await recognitionApi.me();

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/recognition/me');
  });

  it('reads the leaderboard with GET /engagement/recognition/leaderboard, defaulting to month', async () => {
    await recognitionApi.leaderboard();
    expect(sent[0].url).toBe('/engagement/recognition/leaderboard');
    expect(sent[0].params).toEqual({ period: 'month' });

    await recognitionApi.leaderboard('quarter');
    expect(sent[1].params).toEqual({ period: 'quarter' });
  });

  it('lists badges with GET /engagement/recognition/badges', async () => {
    await recognitionApi.badges();
    expect(sent[0].url).toBe('/engagement/recognition/badges');
    expect(sent[0].params).toBeUndefined();

    await recognitionApi.badges(true);
    expect(sent[1].params).toEqual({ includeInactive: true });
  });

  it('creates a badge with POST /engagement/recognition/badges', async () => {
    const payload = { name: 'Team Player', icon: '🤝', points: 10 };
    await recognitionApi.createBadge(payload);

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/recognition/badges');
    expect(body()).toEqual(payload);
  });

  it('updates a badge with PUT /engagement/recognition/badges/:id', async () => {
    await recognitionApi.updateBadge('b-1', { points: 30 });

    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/engagement/recognition/badges/b-1');
    expect(body()).toEqual({ points: 30 });
  });

  it('deactivates a badge with DELETE /engagement/recognition/badges/:id', async () => {
    await recognitionApi.deactivateBadge('b-1');

    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/engagement/recognition/badges/b-1');
  });

  it('reactivates a badge with PUT /engagement/recognition/badges/:id { isActive: true }', async () => {
    await recognitionApi.reactivateBadge('b-1');

    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/engagement/recognition/badges/b-1');
    expect(JSON.parse(sent[0].data)).toEqual({ isActive: true });
  });

  it('removes a recognition with DELETE /engagement/recognition/:id', async () => {
    await recognitionApi.remove('rec-1');

    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/engagement/recognition/rec-1');
  });

  it('reads engagement settings with GET /engagement/settings', async () => {
    await recognitionApi.getSettings();

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/settings');
  });

  it('updates engagement settings with PUT /engagement/settings', async () => {
    const payload = { pointsEnabled: true, monthlyPointsAllowance: 200 };
    await recognitionApi.updateSettings(payload);

    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/engagement/settings');
    expect(body()).toEqual(payload);
  });
});
