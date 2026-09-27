/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { surveysApi } from './api-surveys';

describe('surveys API requests', () => {
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

  it('lists surveys with GET /engagement/surveys', async () => {
    await surveysApi.list({ status: 'ACTIVE', page: 2 });
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/surveys');
    expect(sent[0].params).toEqual({ status: 'ACTIVE', page: 2 });
  });

  it('creates a survey with POST /engagement/surveys', async () => {
    const payload = {
      title: 'Q1 Pulse',
      audienceType: 'ALL' as const,
      audienceIds: [],
      questions: [{ type: 'TEXT' as const, text: 'How do you feel?' }],
    };
    await surveysApi.create(payload);
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/surveys');
    expect(body()).toEqual(payload);
  });

  it('lists my surveys with GET /engagement/surveys/mine', async () => {
    await surveysApi.mine();
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/surveys/mine');
  });

  it('gets one survey with GET /engagement/surveys/:id', async () => {
    await surveysApi.get('survey-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1');
  });

  it('updates a survey with PUT /engagement/surveys/:id', async () => {
    await surveysApi.update('survey-1', { title: 'New title' });
    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1');
    expect(body()).toEqual({ title: 'New title' });
  });

  it('deletes a survey with DELETE /engagement/surveys/:id', async () => {
    await surveysApi.remove('survey-1');
    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1');
  });

  it('launches a survey with POST /engagement/surveys/:id/launch', async () => {
    await surveysApi.launch('survey-1');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1/launch');
  });

  it('closes a survey with POST /engagement/surveys/:id/close', async () => {
    await surveysApi.close('survey-1');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1/close');
  });

  it('gets the respond form with GET /engagement/surveys/:id/form', async () => {
    await surveysApi.form('survey-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1/form');
  });

  it('submits a response with POST /engagement/surveys/:id/responses', async () => {
    const payload = { answers: [{ questionId: 'q-1', text: 'Great' }] };
    await surveysApi.submit('survey-1', payload);
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1/responses');
    expect(body()).toEqual(payload);
  });

  it('gets results with GET /engagement/surveys/:id/results', async () => {
    await surveysApi.results('survey-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1/results');
  });

  it('gets named responses with GET /engagement/surveys/:id/responses', async () => {
    await surveysApi.responses('survey-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/engagement/surveys/survey-1/responses');
  });
});
