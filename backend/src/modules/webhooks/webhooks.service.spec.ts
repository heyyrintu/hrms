import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { WebhookLogStatus } from '@prisma/client';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { WEBHOOK_EVENTS } from './webhook-events';


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

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: any;

  const tenantId = 'tenant-1';
  const originalFetch = global.fetch;

  const webhookRow = {
    id: 'wh-1',
    tenantId,
    url: 'https://example.com/hooks',
    events: ['leave.approved'],
    secret: 'super-secret-value',
    description: 'Payroll bridge',
    isActive: true,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-02T12:00:00Z'),
  };

  beforeEach(async () => {
    dnsLookup.mockResolvedValue(PUBLIC_ADDRESS);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==========================================================================
  // getEvents
  // ==========================================================================

  describe('getEvents', () => {
    it('returns the catalogue', () => {
      const result = service.getEvents();
      expect(result.events).toEqual([...WEBHOOK_EVENTS]);
    });

    it('includes the events the plan calls for', () => {
      const { events } = service.getEvents();
      for (const expected of [
        'employee.created',
        'employee.updated',
        'leave.requested',
        'leave.approved',
        'leave.rejected',
        'attendance.clocked_in',
        'attendance.clocked_out',
        'expense.approved',
        'payroll.run_completed',
      ]) {
        expect(events).toContain(expected);
      }
    });
  });

  // ==========================================================================
  // findAll / findById — secret masking
  // ==========================================================================

  describe('findAll', () => {
    it('scopes the query to the tenant and never returns the raw secret', async () => {
      prisma.webhook.findMany.mockResolvedValue([webhookRow]);

      const result = await service.findAll(tenantId);

      expect(prisma.webhook.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('secret');
      expect(result[0].hasSecret).toBe(true);
      expect(result[0].secretHint).toBe('••••alue');
      expect(JSON.stringify(result)).not.toContain('super-secret-value');
    });

    it('reports a webhook without a secret as unsigned', async () => {
      prisma.webhook.findMany.mockResolvedValue([
        { ...webhookRow, secret: null },
      ]);

      const [view] = await service.findAll(tenantId);

      expect(view.hasSecret).toBe(false);
      expect(view.secretHint).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the masked webhook', async () => {
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);

      const result = await service.findById(tenantId, 'wh-1');

      expect(prisma.webhook.findFirst).toHaveBeenCalledWith({
        where: { id: 'wh-1', tenantId },
      });
      expect(result).not.toHaveProperty('secret');
      expect(result.url).toBe('https://example.com/hooks');
    });

    it('throws NotFound when the webhook belongs to another tenant', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.findById(tenantId, 'wh-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==========================================================================
  // create
  // ==========================================================================

  describe('create', () => {
    it('creates a webhook and masks the secret in the response', async () => {
      prisma.webhook.create.mockResolvedValue(webhookRow);

      const result = await service.create(tenantId, {
        url: 'https://example.com/hooks',
        events: ['leave.approved'],
        secret: 'super-secret-value',
        description: 'Payroll bridge',
      });

      expect(prisma.webhook.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          url: 'https://example.com/hooks',
          events: ['leave.approved'],
          secret: 'super-secret-value',
          description: 'Payroll bridge',
          isActive: true,
        },
      });
      expect(result).not.toHaveProperty('secret');
      expect(result.hasSecret).toBe(true);
    });

    it('rejects a URL that is not absolute', async () => {
      await expect(
        service.create(tenantId, {
          url: '/hooks/hrms',
          events: ['leave.approved'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });

    it('rejects a non-http protocol', async () => {
      await expect(
        service.create(tenantId, {
          url: 'ftp://example.com/hooks',
          events: ['leave.approved'],
        }),
      ).rejects.toThrow('A webhook URL must use http:// or https://');
    });

    it('accepts a plain http URL', async () => {
      prisma.webhook.create.mockResolvedValue({
        ...webhookRow,
        url: 'http://internal.local/hooks',
      });

      const result = await service.create(tenantId, {
        url: 'http://internal.local/hooks',
        events: ['leave.approved'],
      });

      expect(result.url).toBe('http://internal.local/hooks');
    });

    it('rejects an unknown event and names it', async () => {
      await expect(
        service.create(tenantId, {
          url: 'https://example.com/hooks',
          events: ['leave.approved', 'leave.teleported'],
        }),
      ).rejects.toThrow('Unknown webhook event: "leave.teleported"');
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });

    it('rejects an empty events array', async () => {
      await expect(
        service.create(tenantId, {
          url: 'https://example.com/hooks',
          events: [],
        }),
      ).rejects.toThrow('A webhook must subscribe to at least one event');
    });

    it('de-duplicates repeated events so nothing is delivered twice', async () => {
      prisma.webhook.create.mockResolvedValue(webhookRow);

      await service.create(tenantId, {
        url: 'https://example.com/hooks',
        events: ['leave.approved', 'leave.approved'],
      });

      expect(prisma.webhook.create.mock.calls[0][0].data.events).toEqual([
        'leave.approved',
      ]);
    });

    it('stores no secret when none is supplied', async () => {
      prisma.webhook.create.mockResolvedValue({ ...webhookRow, secret: null });

      await service.create(tenantId, {
        url: 'https://example.com/hooks',
        events: ['leave.approved'],
      });

      expect(prisma.webhook.create.mock.calls[0][0].data.secret).toBeNull();
    });
  });

  // ==========================================================================
  // update
  // ==========================================================================

  describe('update', () => {
    beforeEach(() => {
      dnsLookup.mockResolvedValue(PUBLIC_ADDRESS);
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);
      prisma.webhook.update.mockResolvedValue(webhookRow);
    });

    it('updates only the supplied fields', async () => {
      await service.update(tenantId, 'wh-1', { isActive: false });

      expect(prisma.webhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { isActive: false },
      });
    });

    it('validates a supplied URL', async () => {
      await expect(
        service.update(tenantId, 'wh-1', { url: 'not-a-url' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhook.update).not.toHaveBeenCalled();
    });

    it('validates supplied events', async () => {
      await expect(
        service.update(tenantId, 'wh-1', { events: ['nope.nope'] }),
      ).rejects.toThrow('Unknown webhook event: "nope.nope"');
    });

    it('rejects clearing the events list', async () => {
      await expect(
        service.update(tenantId, 'wh-1', { events: [] }),
      ).rejects.toThrow('A webhook must subscribe to at least one event');
    });

    it('treats an empty secret as removing signing', async () => {
      await service.update(tenantId, 'wh-1', { secret: '' });

      expect(prisma.webhook.update.mock.calls[0][0].data.secret).toBeNull();
    });

    it('throws NotFound for a webhook in another tenant', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(
        service.update(tenantId, 'wh-1', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==========================================================================
  // delete
  // ==========================================================================

  describe('delete', () => {
    it('deletes a webhook in the tenant', async () => {
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);
      prisma.webhook.delete.mockResolvedValue(webhookRow);

      const result = await service.delete(tenantId, 'wh-1');

      expect(prisma.webhook.delete).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
      });
      expect(result).toEqual({ message: 'Webhook deleted' });
    });

    it('throws NotFound for an unknown webhook', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.delete(tenantId, 'wh-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.webhook.delete).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // sendTest
  // ==========================================================================

  describe('sendTest', () => {
    it('signs the test delivery and logs SUCCESS on a 2xx', async () => {
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);
      prisma.webhookLog.create.mockImplementation((args: any) => args.data);

      const fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue('ok'),
      });
      global.fetch = fetchMock as any;

      const result: any = await service.sendTest(tenantId, 'wh-1');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://example.com/hooks');
      expect(init.method).toBe('POST');
      expect(init.headers['X-HRMS-Event']).toBe('webhook.test');
      expect(init.headers['X-HRMS-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(result.status).toBe(WebhookLogStatus.SUCCESS);
      expect(result.httpStatus).toBe(200);
      expect(result.attemptCount).toBe(1);
    });

    it('omits the signature when the webhook has no secret', async () => {
      prisma.webhook.findFirst.mockResolvedValue({
        ...webhookRow,
        secret: null,
      });
      prisma.webhookLog.create.mockImplementation((args: any) => args.data);

      const fetchMock = jest.fn().mockResolvedValue({
        status: 204,
        text: jest.fn().mockResolvedValue(''),
      });
      global.fetch = fetchMock as any;

      await service.sendTest(tenantId, 'wh-1');

      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
        'X-HRMS-Signature',
      );
    });

    it('works on an inactive webhook', async () => {
      prisma.webhook.findFirst.mockResolvedValue({
        ...webhookRow,
        isActive: false,
      });
      prisma.webhookLog.create.mockImplementation((args: any) => args.data);

      const fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        text: jest.fn().mockResolvedValue('ok'),
      });
      global.fetch = fetchMock as any;

      const result: any = await service.sendTest(tenantId, 'wh-1');

      expect(fetchMock).toHaveBeenCalled();
      expect(result.status).toBe(WebhookLogStatus.SUCCESS);
    });

    it('logs FAILED with the status when the endpoint rejects it', async () => {
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);
      prisma.webhookLog.create.mockImplementation((args: any) => args.data);

      global.fetch = jest.fn().mockResolvedValue({
        status: 500,
        text: jest.fn().mockResolvedValue('boom'),
      }) as any;

      const result: any = await service.sendTest(tenantId, 'wh-1');

      expect(result.status).toBe(WebhookLogStatus.FAILED);
      expect(result.httpStatus).toBe(500);
      expect(result.errorMessage).toContain('500');
    });

    it('logs FAILED without throwing when the endpoint is unreachable', async () => {
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);
      prisma.webhookLog.create.mockImplementation((args: any) => args.data);

      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

      const result: any = await service.sendTest(tenantId, 'wh-1');

      expect(result.status).toBe(WebhookLogStatus.FAILED);
      expect(result.httpStatus).toBeNull();
      expect(result.errorMessage).toBe('ECONNREFUSED');
    });
  });

  // ==========================================================================
  // getLogs
  // ==========================================================================

  describe('getLogs', () => {
    beforeEach(() => {
      dnsLookup.mockResolvedValue(PUBLIC_ADDRESS);
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);
      prisma.webhookLog.findMany.mockResolvedValue([{ id: 'log-1' }]);
      prisma.webhookLog.count.mockResolvedValue(1);
    });

    it('returns newest-first logs with pagination meta', async () => {
      const result = await service.getLogs(tenantId, 'wh-1', {
        page: 1,
        limit: 20,
      });

      expect(prisma.webhookLog.findMany).toHaveBeenCalledWith({
        where: { tenantId, webhookId: 'wh-1' },
        orderBy: { triggeredAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('filters by status', async () => {
      await service.getLogs(tenantId, 'wh-1', {
        status: WebhookLogStatus.FAILED,
      });

      expect(prisma.webhookLog.findMany.mock.calls[0][0].where).toEqual({
        tenantId,
        webhookId: 'wh-1',
        status: WebhookLogStatus.FAILED,
      });
    });

    it('paginates', async () => {
      await service.getLogs(tenantId, 'wh-1', { page: 3, limit: 10 });

      const args = prisma.webhookLog.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });

    it('throws NotFound for a webhook outside the tenant', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.getLogs(tenantId, 'wh-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
  // ==========================================================================
  // SSRF target guard
  // ==========================================================================

  describe('rejects targets inside the perimeter', () => {
    beforeEach(() => {
      dnsLookup.mockResolvedValue(PUBLIC_ADDRESS);
    });

    it('refuses to create a webhook aimed at the cloud metadata service', async () => {
      await expect(
        service.create(tenantId, {
          url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
          events: ['leave.approved'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });

    it('refuses to create a webhook aimed at loopback', async () => {
      await expect(
        service.create(tenantId, {
          url: 'http://127.0.0.1:5432/',
          events: ['leave.approved'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });

    it('refuses to move an existing webhook onto a private address', async () => {
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);

      await expect(
        service.update(tenantId, 'wh-1', { url: 'http://10.0.0.5/hook' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhook.update).not.toHaveBeenCalled();
    });

    it('refuses a hostname that resolves inward, however public it looks', async () => {
      dnsLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

      await expect(
        service.create(tenantId, {
          url: 'https://totally-normal.example.com/hook',
          events: ['leave.approved'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });

    it('logs a failed delivery instead of dialling a rebound host', async () => {
      // Saved while the name resolved publicly; now it points at loopback.
      prisma.webhook.findFirst.mockResolvedValue(webhookRow);
      prisma.webhookLog.create.mockImplementation((args: any) => args.data);
      dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;

      const log: any = await service.sendTest(tenantId, 'wh-1');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(log.status).toBe(WebhookLogStatus.FAILED);
      expect(log.errorMessage).toMatch(/127\.0\.0\.1/);
    });
  });
});
