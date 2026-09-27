/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { recruitmentApi } from './api-recruitment';

/**
 * Pins the WS-D1 routes of the hiring client (requisitions, openings,
 * pipeline stages, candidates, applications) to the backend contract in the
 * Keka wave C/D spec, Part D.
 */
describe('recruitment API requests (D1)', () => {
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

  describe('requisitions', () => {
    it('lists with GET /recruitment/requisitions', async () => {
      await recruitmentApi.listRequisitions({ status: 'PENDING_APPROVAL' });
      expect(sent[0].method).toBe('get');
      expect(sent[0].url).toBe('/recruitment/requisitions');
      expect(sent[0].params).toEqual({ status: 'PENDING_APPROVAL' });
    });

    it('reads one with GET /recruitment/requisitions/:id', async () => {
      await recruitmentApi.getRequisition('req-1');
      expect(sent[0].method).toBe('get');
      expect(sent[0].url).toBe('/recruitment/requisitions/req-1');
    });

    it('creates with POST /recruitment/requisitions', async () => {
      const payload = { title: 'Backend Engineer', headcount: 2 };
      await recruitmentApi.createRequisition(payload);
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/requisitions');
      expect(body()).toEqual(payload);
    });

    it('updates with PATCH /recruitment/requisitions/:id', async () => {
      await recruitmentApi.updateRequisition('req-1', { title: 'New title' });
      expect(sent[0].method).toBe('patch');
      expect(sent[0].url).toBe('/recruitment/requisitions/req-1');
      expect(body()).toEqual({ title: 'New title' });
    });

    it('submits with POST /recruitment/requisitions/:id/submit', async () => {
      await recruitmentApi.submitRequisition('req-1');
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/requisitions/req-1/submit');
    });

    it('cancels with POST /recruitment/requisitions/:id/cancel', async () => {
      await recruitmentApi.cancelRequisition('req-1');
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/requisitions/req-1/cancel');
    });
  });

  describe('openings', () => {
    it('lists with GET /recruitment/openings', async () => {
      await recruitmentApi.listOpenings({ status: 'OPEN' });
      expect(sent[0].url).toBe('/recruitment/openings');
      expect(sent[0].params).toEqual({ status: 'OPEN' });
    });

    it('reads one with GET /recruitment/openings/:id', async () => {
      await recruitmentApi.getOpening('open-1');
      expect(sent[0].url).toBe('/recruitment/openings/open-1');
    });

    it('creates with POST /recruitment/openings', async () => {
      const payload = { title: 'Engineer', description: 'x' };
      await recruitmentApi.createOpening(payload);
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/openings');
      expect(body()).toEqual(payload);
    });

    it('updates with PATCH /recruitment/openings/:id', async () => {
      await recruitmentApi.updateOpening('open-1', { title: 'New' });
      expect(sent[0].method).toBe('patch');
      expect(sent[0].url).toBe('/recruitment/openings/open-1');
    });

    it('publishes / holds / closes', async () => {
      await recruitmentApi.publishOpening('open-1');
      expect(sent[0].url).toBe('/recruitment/openings/open-1/publish');
      await recruitmentApi.holdOpening('open-1');
      expect(sent[1].url).toBe('/recruitment/openings/open-1/hold');
      await recruitmentApi.closeOpening('open-1');
      expect(sent[2].url).toBe('/recruitment/openings/open-1/close');
    });

    it('lists applications with GET /recruitment/openings/:id/applications', async () => {
      await recruitmentApi.listOpeningApplications('open-1');
      expect(sent[0].method).toBe('get');
      expect(sent[0].url).toBe('/recruitment/openings/open-1/applications');
    });
  });

  describe('pipeline stages', () => {
    it('lists with GET /recruitment/pipeline-stages', async () => {
      await recruitmentApi.listStages();
      expect(sent[0].method).toBe('get');
      expect(sent[0].url).toBe('/recruitment/pipeline-stages');
    });

    it('replaces with PUT /recruitment/pipeline-stages', async () => {
      const stages = [{ name: 'Applied', category: 'APPLIED' as const }];
      await recruitmentApi.replaceStages(stages);
      expect(sent[0].method).toBe('put');
      expect(sent[0].url).toBe('/recruitment/pipeline-stages');
      expect(body()).toEqual({ stages });
    });
  });

  describe('candidates', () => {
    it('lists with GET /recruitment/candidates', async () => {
      await recruitmentApi.listCandidates({ search: 'jane' });
      expect(sent[0].url).toBe('/recruitment/candidates');
      expect(sent[0].params).toEqual({ search: 'jane' });
    });

    it('reads one with GET /recruitment/candidates/:id', async () => {
      await recruitmentApi.getCandidate('cand-1');
      expect(sent[0].url).toBe('/recruitment/candidates/cand-1');
    });

    it('creates with POST /recruitment/candidates', async () => {
      const payload = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' };
      await recruitmentApi.createCandidate(payload);
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/candidates');
      expect(body()).toEqual(payload);
    });

    it('updates with PATCH /recruitment/candidates/:id', async () => {
      await recruitmentApi.updateCandidate('cand-1', { phone: '1234567890' });
      expect(sent[0].method).toBe('patch');
      expect(sent[0].url).toBe('/recruitment/candidates/cand-1');
    });
  });

  describe('applications', () => {
    it('creates with POST /recruitment/applications', async () => {
      const payload = { candidateId: 'cand-1', jobOpeningId: 'open-1' };
      await recruitmentApi.createApplication(payload);
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/applications');
      expect(body()).toEqual(payload);
    });

    it('reads one with GET /recruitment/applications/:id', async () => {
      await recruitmentApi.getApplication('app-1');
      expect(sent[0].url).toBe('/recruitment/applications/app-1');
    });

    it('moves with POST /recruitment/applications/:id/move', async () => {
      await recruitmentApi.moveApplication('app-1', { stageId: 'stage-2' });
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/applications/app-1/move');
      expect(body()).toEqual({ stageId: 'stage-2' });
    });

    it('rejects with POST /recruitment/applications/:id/reject', async () => {
      await recruitmentApi.rejectApplication('app-1', 'Not a fit');
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/applications/app-1/reject');
      expect(body()).toEqual({ reason: 'Not a fit' });
    });

    it('withdraws with POST /recruitment/applications/:id/withdraw', async () => {
      await recruitmentApi.withdrawApplication('app-1');
      expect(sent[0].method).toBe('post');
      expect(sent[0].url).toBe('/recruitment/applications/app-1/withdraw');
    });
  });
});
