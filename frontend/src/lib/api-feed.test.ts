/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { feedApi } from './api-feed';

describe('feed API requests', () => {
  let sent: InternalAxiosRequestConfig[];

  beforeEach(() => {
    sent = [];
    api.defaults.adapter = async (config) => {
      sent.push(config);
      return {
        data: { items: [], nextCursor: null },
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };
  });

  it('lists the feed with GET /engagement/feed and cursor/limit params', async () => {
    await feedApi.list('cursor-1', 10);

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/feed');
    expect(sent[0].params).toEqual({ cursor: 'cursor-1', limit: 10 });
  });

  it('lists the feed with no params when called bare', async () => {
    await feedApi.list();

    expect(sent[0].method).toBe('get');
    expect(sent[0].params).toEqual({ cursor: undefined, limit: undefined });
  });

  it('toggles a reaction with POST /engagement/feed/:id/reactions', async () => {
    await feedApi.react('item-1', 'LIKE');

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/feed/item-1/reactions');
    expect(JSON.parse(sent[0].data)).toEqual({ kind: 'LIKE' });
  });

  it('hides an item with POST /engagement/feed/:id/hide', async () => {
    await feedApi.hide('item-1');

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/feed/item-1/hide');
  });
});
