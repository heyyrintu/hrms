/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { attendancePolicyApi } from './api-attendance-policy';

/**
 * The policy lives under its own `/attendance-policy` prefix. A nested
 * `/attendance/policy` would be swallowed by the attendance controller's
 * `GET /attendance/:employeeId` and answer with the wrong resource, so the
 * routes are pinned here rather than trusted to stay put.
 */
describe('attendance policy API requests', () => {
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

    it('reads the policy from /attendance-policy', async () => {
        await attendancePolicyApi.get();

        expect(sent[0].method).toBe('get');
        expect(sent[0].url).toBe('/attendance-policy');
        expect(sent[0].url).not.toBe('/attendance/policy');
    });

    it('saves the policy with PUT /attendance-policy and sends only the changed fields', async () => {
        await attendancePolicyApi.update({ minHalfDayMinutes: 240, minFullDayMinutes: 480 });

        expect(sent[0].method).toBe('put');
        expect(sent[0].url).toBe('/attendance-policy');
        expect(JSON.parse(sent[0].data)).toEqual({
            minHalfDayMinutes: 240,
            minFullDayMinutes: 480,
        });
    });

    it('sweeps a day with POST /attendance/mark-absent', async () => {
        await attendancePolicyApi.markAbsent('2026-03-16');

        expect(sent[0].method).toBe('post');
        expect(sent[0].url).toBe('/attendance/mark-absent');
        expect(JSON.parse(sent[0].data)).toEqual({ date: '2026-03-16' });
    });
});
