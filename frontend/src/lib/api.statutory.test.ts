/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api, form16Api, returnsApi, settlementApi } from './api';
import { StatutoryReturnKind } from '@/types/statutory';

/**
 * These cover the request each statutory call actually makes.
 *
 * The wrappers are thin, but three details are load-bearing and easy to break
 * without noticing: the preview depends on `download=false` to get JSON instead
 * of a file, the PDF and file downloads depend on `responseType: 'blob'` to
 * avoid a corrupted binary, and the routes have to match the controllers.
 */
describe('statutory API requests', () => {
    let sent: InternalAxiosRequestConfig[];

    beforeEach(() => {
        sent = [];
        // jsdom implements neither, and every download path goes through them.
        window.URL.createObjectURL = jest.fn().mockReturnValue('blob:stub');
        window.URL.revokeObjectURL = jest.fn();
        api.defaults.adapter = async (config) => {
            sent.push(config);
            return {
                data: config.responseType === 'blob' ? new Blob(['file']) : { ok: true },
                status: 200,
                statusText: 'OK',
                headers: new AxiosHeaders(),
                config,
            };
        };
    });

    describe('returnsApi', () => {
        it('asks for JSON rather than a file when previewing', async () => {
            await returnsApi.preview('run-1', StatutoryReturnKind.PF_ECR);

            expect(sent[0].url).toBe('/payroll/returns/run-1/pf-ecr');
            // Without this the server streams the file and the warnings, which
            // say who was left out of the return, never reach the page.
            expect(sent[0].params).toEqual({ download: 'false' });
        });

        it('requests a blob when downloading, so the file is not mangled as text', async () => {
            await returnsApi.download('run-1', StatutoryReturnKind.ESI, 'esi.txt');

            expect(sent[0].url).toBe('/payroll/returns/run-1/esi');
            expect(sent[0].responseType).toBe('blob');
        });

        it('saves a held preview without going back to the server', () => {
            const click = jest.fn();
            const anchor = { href: '', setAttribute: jest.fn(), click, remove: jest.fn() };
            jest.spyOn(document, 'createElement').mockReturnValue(anchor as never);
            jest.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
            returnsApi.saveContent('1#~#2', 'ecr.txt');

            expect(sent).toHaveLength(0);
            expect(anchor.setAttribute).toHaveBeenCalledWith('download', 'ecr.txt');
            expect(click).toHaveBeenCalled();
            // The blob is held in memory until revoked and a return can be large.
            expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:stub');
            jest.restoreAllMocks();
        });
    });

    describe('form16Api', () => {
        it('routes an employee to their own certificate', async () => {
            await form16Api.getMine(2026);
            expect(sent[0].url).toBe('/payroll/form16/my/2026');
        });

        it('routes payroll staff to a named employee', async () => {
            await form16Api.getForEmployee('emp-7', 2026);
            expect(sent[0].url).toBe('/payroll/form16/emp-7/2026');
        });

        it('requests the PDF as a blob', async () => {
            await form16Api.downloadMine(2026, 'form16.pdf');

            expect(sent[0].url).toBe('/payroll/form16/my/2026/pdf');
            expect(sent[0].responseType).toBe('blob');
        });
    });

    describe('settlementApi', () => {
        it('computes against the separation, not the settlement', async () => {
            await settlementApi.compute('sep-1', { waiveGratuityMinimumService: true });

            expect(sent[0].url).toBe('/exit/settlements/separations/sep-1/compute');
            expect(sent[0].method).toBe('post');
        });

        it('sends an empty body when no waiver is claimed', async () => {
            await settlementApi.compute('sep-1');
            expect(sent[0].data).toBe(JSON.stringify({}));
        });

        it('approves and pays by settlement id', async () => {
            await settlementApi.approve('set-1');
            await settlementApi.markAsPaid('set-1');

            expect(sent[0].url).toBe('/exit/settlements/set-1/approve');
            expect(sent[1].url).toBe('/exit/settlements/set-1/pay');
        });
    });
});
