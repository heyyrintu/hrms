/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { recruitmentApi } from './api-recruitment';
import { publicApi, publicOfferApi } from './api-careers';

/**
 * Pins the D2 (interviews, feedback, offers) client routes to the backend
 * controllers, and the public offer client to /public/offers.
 */
describe('recruitment D2 API requests', () => {
  let sent: InternalAxiosRequestConfig[];

  const adapter = async (config: InternalAxiosRequestConfig) => {
    sent.push(config);
    return { data: {}, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
  };

  beforeEach(() => {
    sent = [];
    api.defaults.adapter = adapter;
    publicApi.defaults.adapter = adapter;
  });

  const last = () => sent[sent.length - 1];
  const body = () => (last().data ? JSON.parse(last().data) : undefined);

  it('interviews: list, schedule, update, status changes, mine', async () => {
    await recruitmentApi.listInterviews('app-1');
    expect([last().method, last().url]).toEqual(['get', '/recruitment/applications/app-1/interviews']);

    const payload = {
      roundName: 'R1',
      scheduledStart: '2026-03-15T09:00:00Z',
      scheduledEnd: '2026-03-15T10:00:00Z',
      mode: 'VIDEO' as const,
      panelEmployeeIds: ['e1'],
    };
    await recruitmentApi.scheduleInterview('app-1', payload);
    expect([last().method, last().url]).toEqual(['post', '/recruitment/applications/app-1/interviews']);
    expect(body()).toEqual(payload);

    await recruitmentApi.updateInterview('int-1', { roundName: 'R2' });
    expect([last().method, last().url]).toEqual(['patch', '/recruitment/interviews/int-1']);

    await recruitmentApi.cancelInterview('int-1');
    expect(last().url).toBe('/recruitment/interviews/int-1/cancel');
    await recruitmentApi.completeInterview('int-1');
    expect(last().url).toBe('/recruitment/interviews/int-1/complete');
    await recruitmentApi.markInterviewNoShow('int-1');
    expect(last().url).toBe('/recruitment/interviews/int-1/no-show');

    await recruitmentApi.myInterviews();
    expect([last().method, last().url]).toEqual(['get', '/recruitment/interviews/mine']);
  });

  it('feedback: read and submit', async () => {
    await recruitmentApi.getFeedback('int-1');
    expect([last().method, last().url]).toEqual(['get', '/recruitment/interviews/int-1/feedback']);
    const fb = { overallRating: 4, recommendation: 'HIRE' as const, scores: [{ criterion: 'X', rating: 4 }] };
    await recruitmentApi.submitFeedback('int-1', fb);
    expect([last().method, last().url]).toEqual(['post', '/recruitment/interviews/int-1/feedback']);
    expect(body()).toEqual(fb);
  });

  it('offers: list, CRUD, lifecycle, convert, pdf', async () => {
    await recruitmentApi.listOffers({ status: 'SENT' });
    expect([last().method, last().url, last().params]).toEqual(['get', '/recruitment/offers', { status: 'SENT' }]);

    const offer = { templateId: 't1', annualCtc: 1200000, joiningDate: '2026-04-01' };
    await recruitmentApi.createOffer('app-1', offer);
    expect([last().method, last().url]).toEqual(['post', '/recruitment/applications/app-1/offers']);
    expect(body()).toEqual(offer);

    await recruitmentApi.getOffer('off-1');
    expect([last().method, last().url]).toEqual(['get', '/recruitment/offers/off-1']);
    await recruitmentApi.updateOffer('off-1', { annualCtc: 1 });
    expect([last().method, last().url]).toEqual(['patch', '/recruitment/offers/off-1']);

    for (const [fn, suffix] of [
      [recruitmentApi.submitOffer, 'submit'],
      [recruitmentApi.sendOffer, 'send'],
      [recruitmentApi.withdrawOffer, 'withdraw'],
    ] as const) {
      await fn('off-1');
      expect([last().method, last().url]).toEqual(['post', `/recruitment/offers/off-1/${suffix}`]);
    }

    await recruitmentApi.convertOffer('off-1', { employeeCode: 'E1', createUser: false });
    expect([last().method, last().url]).toEqual(['post', '/recruitment/offers/off-1/convert']);
    expect(body()).toEqual({ employeeCode: 'E1', createUser: false });

    await recruitmentApi.offerPdf('off-1');
    expect([last().url, last().responseType]).toEqual(['/recruitment/offers/off-1/pdf', 'blob']);
  });

  it('public offer: get, accept, decline — token URL-encoded, no auth header', async () => {
    const token = 'c'.repeat(64);
    await publicOfferApi.get(token);
    expect([last().method, last().url]).toEqual(['get', `/public/offers/${token}`]);
    expect(last().headers?.Authorization).toBeUndefined();

    await publicOfferApi.accept(token, 'Asha Rao');
    expect([last().method, last().url]).toEqual(['post', `/public/offers/${token}/accept`]);
    expect(body()).toEqual({ acceptedName: 'Asha Rao' });

    await publicOfferApi.decline(token, 'Elsewhere');
    expect([last().method, last().url]).toEqual(['post', `/public/offers/${token}/decline`]);
    expect(body()).toEqual({ reason: 'Elsewhere' });

    await publicOfferApi.get('../x');
    expect(last().url).toBe('/public/offers/..%2Fx');
  });
});
