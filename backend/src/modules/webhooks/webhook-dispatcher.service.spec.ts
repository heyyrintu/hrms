import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType, WebhookLogStatus } from '@prisma/client';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';


// Every hostname in this spec is treated as resolving to a public address, so
// the SSRF target check is exercised in its own spec rather than here. Without
// this the guard would do a real DNS lookup for every delivery.
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { lookup: dnsLookup } = require('node:dns/promises') as {
  lookup: jest.Mock;
};
const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

// These specs drive delivery through a mocked global.fetch. webhookFetch is the
// real client and has its own spec against a live server (webhook-http.spec.ts);
// here it is routed to that mock so the assertions below stay about the service.
jest.mock('./webhook-http', () => ({
  webhookFetch: (...args: any[]) => (global.fetch as any)(...args),
}));

describe('WebhookDispatcherService', () => {
  let service: WebhookDispatcherService;
  let prisma: any;
  let notificationsService: any;
  let fetchMock: jest.Mock;

  const tenantId = 'tenant-1';
  const originalFetch = global.fetch;

  const activeWebhook = {
    id: 'wh-1',
    tenantId,
    url: 'https://example.com/hooks',
    events: ['leave.approved'],
    secret: 'shhh',
    isActive: true,
  };

  const ok = (status = 200, body = 'ok') => ({
    status,
    text: jest.fn().mockResolvedValue(body),
  });

  beforeEach(async () => {
    dnsLookup.mockResolvedValue(PUBLIC_ADDRESS);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatcherService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
      ],
    }).compile();

    service = module.get<WebhookDispatcherService>(WebhookDispatcherService);
    prisma = module.get(PrismaService);
    notificationsService = module.get(NotificationsService);

    prisma.webhookLog.create.mockImplementation((args: any) => args.data);

    fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    // The real backoff would make the exhausted-retry tests wait five seconds.
    jest
      .spyOn(service as any, 'sleep')
      .mockImplementation(() => Promise.resolve());
    // Failures are logged on purpose; keep the test output readable.
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================================================
  // Selecting which webhooks receive the event
  // ==========================================================================

  describe('selection', () => {
    it('queries only active webhooks in the tenant subscribed to the event', async () => {
      prisma.webhook.findMany.mockResolvedValue([]);

      await service.dispatch(tenantId, 'leave.approved', { id: 'lr-1' });

      expect(prisma.webhook.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          isActive: true,
          events: { has: 'leave.approved' },
        },
      });
    });

    it('returns quietly when no webhook matches', async () => {
      prisma.webhook.findMany.mockResolvedValue([]);

      await expect(
        service.dispatch(tenantId, 'leave.approved', {}),
      ).resolves.toBeUndefined();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.webhookLog.create).not.toHaveBeenCalled();
    });

    it('skips a webhook not subscribed to the event', async () => {
      // The `events: { has: ... }` filter is what excludes it, so the query
      // returns nothing and nothing is delivered.
      prisma.webhook.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          activeWebhook.events.includes(where.events.has) ? [activeWebhook] : [],
        ),
      );
      fetchMock.mockResolvedValue(ok());

      await service.dispatch(tenantId, 'payroll.run_completed', {});

      expect(fetchMock).not.toHaveBeenCalled();

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('skips an inactive webhook', async () => {
      prisma.webhook.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.isActive === true ? [] : [activeWebhook]),
      );

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.webhookLog.create).not.toHaveBeenCalled();
    });

    it('delivers to every matching webhook', async () => {
      prisma.webhook.findMany.mockResolvedValue([
        activeWebhook,
        { ...activeWebhook, id: 'wh-2', url: 'https://other.example/hooks' },
      ]);
      fetchMock.mockResolvedValue(ok());

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(prisma.webhookLog.create).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // Request shape
  // ==========================================================================

  describe('request', () => {
    it('POSTs { event, timestamp, data } with the documented headers', async () => {
      prisma.webhook.findMany.mockResolvedValue([activeWebhook]);
      fetchMock.mockResolvedValue(ok());

      await service.dispatch(tenantId, 'leave.approved', { leaveId: 'lr-9' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://example.com/hooks');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['X-HRMS-Event']).toBe('leave.approved');
      expect(init.headers['X-HRMS-Delivery']).toMatch(
        /^[0-9a-f-]{36}$/,
      );

      const body = JSON.parse(init.body);
      expect(body.event).toBe('leave.approved');
      expect(body.data).toEqual({ leaveId: 'lr-9' });
      expect(typeof body.timestamp).toBe('string');
    });

    it('signs the exact request body with the webhook secret', async () => {
      prisma.webhook.findMany.mockResolvedValue([activeWebhook]);
      fetchMock.mockResolvedValue(ok());

      await service.dispatch(tenantId, 'leave.approved', { leaveId: 'lr-9' });

      const init = fetchMock.mock.calls[0][1];
      const signature = init.headers['X-HRMS-Signature'];

      expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createHmac } = require('node:crypto');
      const expected = `sha256=${createHmac('sha256', 'shhh')
        .update(init.body)
        .digest('hex')}`;
      expect(signature).toBe(expected);
    });

    it('sends no signature header when the webhook has no secret', async () => {
      prisma.webhook.findMany.mockResolvedValue([
        { ...activeWebhook, secret: null },
      ]);
      fetchMock.mockResolvedValue(ok());

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
        'X-HRMS-Signature',
      );
    });

    it('sets a request timeout', async () => {
      prisma.webhook.findMany.mockResolvedValue([activeWebhook]);
      fetchMock.mockResolvedValue(ok());

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
    });
  });

  // ==========================================================================
  // Outcomes
  // ==========================================================================

  describe('delivery outcomes', () => {
    beforeEach(() => {
      dnsLookup.mockResolvedValue(PUBLIC_ADDRESS);
      prisma.webhook.findMany.mockResolvedValue([activeWebhook]);
    });

    it('logs SUCCESS on a first-attempt 200', async () => {
      fetchMock.mockResolvedValue(ok(200, 'thanks'));

      await service.dispatch(tenantId, 'leave.approved', { a: 1 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const logged = prisma.webhookLog.create.mock.calls[0][0].data;
      expect(logged).toMatchObject({
        tenantId,
        webhookId: 'wh-1',
        event: 'leave.approved',
        status: WebhookLogStatus.SUCCESS,
        httpStatus: 200,
        responseBody: 'thanks',
        errorMessage: null,
        attemptCount: 1,
      });
      expect(notificationsService.notifyByRole).not.toHaveBeenCalled();
    });

    it('treats any 2xx as success', async () => {
      fetchMock.mockResolvedValue(ok(204, ''));

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(prisma.webhookLog.create.mock.calls[0][0].data.status).toBe(
        WebhookLogStatus.SUCCESS,
      );
    });

    it('retries a failure then succeeds, logging one row with the real attempt count', async () => {
      fetchMock
        .mockResolvedValueOnce(ok(503, 'unavailable'))
        .mockResolvedValueOnce(ok(200, 'ok'));

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(prisma.webhookLog.create).toHaveBeenCalledTimes(1);

      const logged = prisma.webhookLog.create.mock.calls[0][0].data;
      expect(logged.status).toBe(WebhookLogStatus.SUCCESS);
      expect(logged.attemptCount).toBe(2);
      expect(notificationsService.notifyByRole).not.toHaveBeenCalled();
    });

    it('gives up after three attempts, logs FAILED and notifies the admins', async () => {
      fetchMock.mockResolvedValue(ok(500, 'server error'));

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(prisma.webhookLog.create).toHaveBeenCalledTimes(1);

      const logged = prisma.webhookLog.create.mock.calls[0][0].data;
      expect(logged.status).toBe(WebhookLogStatus.FAILED);
      expect(logged.attemptCount).toBe(3);
      expect(logged.httpStatus).toBe(500);
      expect(logged.errorMessage).toContain('500');

      expect(notificationsService.notifyByRole).toHaveBeenCalledWith(
        tenantId,
        ['HR_ADMIN', 'SUPER_ADMIN'],
        NotificationType.WEBHOOK_DELIVERY_FAILED,
        'Webhook delivery failed',
        expect.stringContaining('https://example.com/hooks'),
        '/admin/webhooks',
      );
    });

    it('never logs RETRYING as the final status', async () => {
      fetchMock.mockResolvedValue(ok(500, 'server error'));

      await service.dispatch(tenantId, 'leave.approved', {});

      const logged = prisma.webhookLog.create.mock.calls[0][0].data;
      expect(logged.status).not.toBe(WebhookLogStatus.RETRYING);
      expect([
        WebhookLogStatus.SUCCESS,
        WebhookLogStatus.FAILED,
      ]).toContain(logged.status);
    });

    it('truncates an oversized response body', async () => {
      fetchMock.mockResolvedValue(ok(200, 'x'.repeat(10_000)));

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(
        prisma.webhookLog.create.mock.calls[0][0].data.responseBody.length,
      ).toBe(2_000);
    });
  });

  // ==========================================================================
  // Nothing may escape into the caller
  // ==========================================================================

  describe('error containment', () => {
    it('does not propagate a network error', async () => {
      prisma.webhook.findMany.mockResolvedValue([activeWebhook]);
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.dispatch(tenantId, 'leave.approved', {}),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const logged = prisma.webhookLog.create.mock.calls[0][0].data;
      expect(logged.status).toBe(WebhookLogStatus.FAILED);
      expect(logged.errorMessage).toBe('ECONNREFUSED');
      expect(logged.httpStatus).toBeNull();
    });

    it('does not propagate a timeout', async () => {
      prisma.webhook.findMany.mockResolvedValue([activeWebhook]);
      fetchMock.mockRejectedValue(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      );

      await expect(
        service.dispatch(tenantId, 'leave.approved', {}),
      ).resolves.toBeUndefined();

      expect(
        prisma.webhookLog.create.mock.calls[0][0].data.errorMessage,
      ).toContain('timeout');
    });

    it('does not propagate a failure to look the webhooks up', async () => {
      prisma.webhook.findMany.mockRejectedValue(new Error('db is down'));

      await expect(
        service.dispatch(tenantId, 'leave.approved', {}),
      ).resolves.toBeUndefined();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not propagate a failure to write the log row', async () => {
      prisma.webhook.findMany.mockResolvedValue([activeWebhook]);
      fetchMock.mockResolvedValue(ok());
      prisma.webhookLog.create.mockRejectedValue(new Error('log insert failed'));

      await expect(
        service.dispatch(tenantId, 'leave.approved', {}),
      ).resolves.toBeUndefined();
    });

    it('does not propagate a failure to notify the admins', async () => {
      prisma.webhook.findMany.mockResolvedValue([activeWebhook]);
      fetchMock.mockResolvedValue(ok(500, 'nope'));
      notificationsService.notifyByRole.mockRejectedValue(
        new Error('notification insert failed'),
      );

      await expect(
        service.dispatch(tenantId, 'leave.approved', {}),
      ).resolves.toBeUndefined();
    });

    it('keeps delivering to later webhooks after an earlier one dies', async () => {
      prisma.webhook.findMany.mockResolvedValue([
        activeWebhook,
        { ...activeWebhook, id: 'wh-2', url: 'https://other.example/hooks' },
      ]);
      fetchMock
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue(ok());

      await service.dispatch(tenantId, 'leave.approved', {});

      expect(prisma.webhookLog.create).toHaveBeenCalledTimes(2);
      expect(prisma.webhookLog.create.mock.calls[0][0].data.status).toBe(
        WebhookLogStatus.FAILED,
      );
      expect(prisma.webhookLog.create.mock.calls[1][0].data.status).toBe(
        WebhookLogStatus.SUCCESS,
      );
    });
  });
});
