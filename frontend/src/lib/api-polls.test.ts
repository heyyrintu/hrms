/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { pollsApi } from './api-polls';

describe('polls API requests', () => {
  let sent: InternalAxiosRequestConfig[];

  beforeEach(() => {
    sent = [];
    api.defaults.adapter = async (config) => {
      sent.push(config);
      return {
        data: [],
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };
  });

  it('reads open polls with GET /engagement/polls/active', async () => {
    await pollsApi.active();

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/polls/active');
  });

  it('lists all polls with GET /engagement/polls and forwards pagination', async () => {
    await pollsApi.list({ page: 2, limit: 5 });

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/polls');
    expect(sent[0].params).toEqual({ page: 2, limit: 5 });
  });

  it('creates a poll with POST /engagement/polls', async () => {
    await pollsApi.create({ question: 'Q?', options: ['A', 'B'] });

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/polls');
    expect(JSON.parse(sent[0].data)).toEqual({ question: 'Q?', options: ['A', 'B'] });
  });

  it('votes with POST /engagement/polls/:id/vote', async () => {
    await pollsApi.vote('poll-1', 'opt-1');

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/polls/poll-1/vote');
    expect(JSON.parse(sent[0].data)).toEqual({ optionId: 'opt-1' });
  });

  it('closes a poll with POST /engagement/polls/:id/close', async () => {
    await pollsApi.close('poll-1');

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/polls/poll-1/close');
  });

  it('deletes a poll with DELETE /engagement/polls/:id', async () => {
    await pollsApi.remove('poll-1');

    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/engagement/polls/poll-1');
  });
});
