/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { oneOnOnesApi } from './api-one-on-ones';

/**
 * `counterparts` and `open-items` are declared before `:id` on the backend
 * so they are not swallowed as a meeting id; pinned here so a refactor can't
 * quietly point them at `/engagement/one-on-ones/counterparts` being read as
 * an id instead.
 */
describe('one-on-ones API requests', () => {
  let sent: InternalAxiosRequestConfig[];

  beforeEach(() => {
    sent = [];
    api.defaults.adapter = async (config) => {
      sent.push(config);
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };
  });

  it('lists my one-on-ones with query params', async () => {
    await oneOnOnesApi.list({ counterpartId: 'emp-2', status: 'SCHEDULED' });

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/one-on-ones');
    expect(sent[0].params).toEqual({ counterpartId: 'emp-2', status: 'SCHEDULED' });
  });

  it('schedules a one-on-one', async () => {
    await oneOnOnesApi.create({
      counterpartId: 'emp-2',
      scheduledAt: '2026-03-15T12:00:00Z',
      agenda: 'Career growth',
    });

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/one-on-ones');
    expect(JSON.parse(sent[0].data)).toEqual({
      counterpartId: 'emp-2',
      scheduledAt: '2026-03-15T12:00:00Z',
      agenda: 'Career growth',
    });
  });

  it('reads counterparts from its own route, not as an :id', async () => {
    await oneOnOnesApi.counterparts();

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/one-on-ones/counterparts');
  });

  it('reads open items with a counterpartId query param', async () => {
    await oneOnOnesApi.openItems('emp-2');

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/one-on-ones/open-items');
    expect(sent[0].params).toEqual({ counterpartId: 'emp-2' });
  });

  it('gets a one-on-one by id', async () => {
    await oneOnOnesApi.get('meeting-1');

    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/one-on-ones/meeting-1');
  });

  it('updates a one-on-one', async () => {
    await oneOnOnesApi.update('meeting-1', { sharedNotes: 'notes', status: 'COMPLETED' });

    expect(sent[0].method).toBe('patch');
    expect(sent[0].url).toBe('/engagement/one-on-ones/meeting-1');
    expect(JSON.parse(sent[0].data)).toEqual({ sharedNotes: 'notes', status: 'COMPLETED' });
  });

  it('adds an action item', async () => {
    await oneOnOnesApi.addItem('meeting-1', { text: 'Follow up', assigneeId: 'emp-2' });

    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/one-on-ones/meeting-1/action-items');
    expect(JSON.parse(sent[0].data)).toEqual({ text: 'Follow up', assigneeId: 'emp-2' });
  });

  it('updates an action item', async () => {
    await oneOnOnesApi.updateItem('meeting-1', 'item-1', { isDone: true });

    expect(sent[0].method).toBe('patch');
    expect(sent[0].url).toBe('/engagement/one-on-ones/meeting-1/action-items/item-1');
    expect(JSON.parse(sent[0].data)).toEqual({ isDone: true });
  });

  it('removes an action item', async () => {
    await oneOnOnesApi.removeItem('meeting-1', 'item-1');

    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/engagement/one-on-ones/meeting-1/action-items/item-1');
  });

  it('saves my private note', async () => {
    await oneOnOnesApi.savePrivateNote('meeting-1', 'only for me');

    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/engagement/one-on-ones/meeting-1/private-note');
    expect(JSON.parse(sent[0].data)).toEqual({ content: 'only for me' });
  });
});
