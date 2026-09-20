import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { WebhookLogStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookLogQueryDto,
} from './dto/webhook.dto';
import { WEBHOOK_EVENTS, isWebhookEvent } from './webhook-events';
import {
  assertPublicWebhookTarget,
  UnsafeWebhookTargetError,
} from './url-safety';

/** Matches the dispatcher so a test delivery behaves like a real one. */
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY = 2_000;

/**
 * The shape every webhook response takes.
 *
 * A webhook's secret is write-only. It is what proves a delivery came from us,
 * so it is never echoed back — not on create, not on read, not to the admin who
 * typed it. Callers get `hasSecret` and the last four characters, which is
 * enough to tell two secrets apart without being enough to forge a signature.
 */
export interface WebhookView {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  hasSecret: boolean;
  secretHint: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WebhookRow {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  secret: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class WebhooksService {
  constructor(private prisma: PrismaService) {}

  getEvents() {
    return { events: [...WEBHOOK_EVENTS] };
  }

  async findAll(tenantId: string): Promise<WebhookView[]> {
    const webhooks = await this.prisma.webhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return (webhooks as WebhookRow[]).map((w) => this.toView(w));
  }

  async findById(tenantId: string, id: string): Promise<WebhookView> {
    return this.toView(await this.getOrFail(tenantId, id));
  }

  async create(tenantId: string, dto: CreateWebhookDto): Promise<WebhookView> {
    const url = this.validateUrl(dto.url);
    await this.assertTargetAllowed(url);
    const events = this.validateEvents(dto.events);

    const created = await this.prisma.webhook.create({
      data: {
        tenantId,
        url,
        events,
        secret: dto.secret ? dto.secret : null,
        description: dto.description ?? null,
        isActive: dto.isActive ?? true,
      },
    });

    return this.toView(created as WebhookRow);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateWebhookDto,
  ): Promise<WebhookView> {
    await this.getOrFail(tenantId, id);

    const data: Record<string, unknown> = {};

    if (dto.url !== undefined) {
      data.url = this.validateUrl(dto.url);
      await this.assertTargetAllowed(data.url as string);
    }
    if (dto.events !== undefined) {
      data.events = this.validateEvents(dto.events);
    }
    if (dto.secret !== undefined) {
      // An empty string is the only way to take signing back off.
      data.secret = dto.secret === '' ? null : dto.secret;
    }
    if (dto.description !== undefined) {
      data.description = dto.description === '' ? null : dto.description;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    const updated = await this.prisma.webhook.update({
      where: { id },
      data,
    });

    return this.toView(updated as WebhookRow);
  }

  async delete(tenantId: string, id: string) {
    await this.getOrFail(tenantId, id);
    // WebhookLog cascades on the foreign key, so the delivery history goes too.
    await this.prisma.webhook.delete({ where: { id } });
    return { message: 'Webhook deleted' };
  }

  /**
   * Sends one signed sample delivery straight away and returns the log row.
   *
   * Deliberately works on an inactive webhook: the whole point is to check an
   * endpoint before switching it on.
   */
  async sendTest(tenantId: string, id: string) {
    const webhook = await this.getOrFail(tenantId, id);

    const event = 'webhook.test';
    const payload = {
      message: 'This is a test delivery from HRMS.',
      webhookId: webhook.id,
    };
    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-HRMS-Event': event,
      'X-HRMS-Delivery': randomUUID(),
    };

    if (webhook.secret) {
      headers['X-HRMS-Signature'] = `sha256=${createHmac('sha256', webhook.secret)
        .update(body)
        .digest('hex')}`;
    }

    let status: WebhookLogStatus = WebhookLogStatus.FAILED;
    let httpStatus: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;

    try {
      // Re-checked here, not just on save: a hostname that passed validation
      // can point somewhere else by the time it is dialled.
      await assertPublicWebhookTarget(webhook.url);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        // A public URL that redirects to 127.0.0.1 would otherwise walk
        // straight past the target check.
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      httpStatus = response.status;

      try {
        responseBody = (await response.text()).slice(0, MAX_RESPONSE_BODY);
      } catch {
        responseBody = null;
      }

      if (response.status >= 200 && response.status < 300) {
        status = WebhookLogStatus.SUCCESS;
      } else {
        errorMessage =
          response.status >= 300 && response.status < 400
            ? `Endpoint responded ${response.status}; redirects are not followed`
            : `Endpoint responded ${response.status}`;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    return this.prisma.webhookLog.create({
      data: {
        tenantId,
        webhookId: webhook.id,
        event,
        payload: payload as any,
        status,
        httpStatus,
        responseBody,
        errorMessage,
        attemptCount: 1,
      },
    });
  }

  async getLogs(tenantId: string, id: string, query: WebhookLogQueryDto) {
    await this.getOrFail(tenantId, id);

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId, webhookId: id };
    if (query.status) {
      where.status = query.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.webhookLog.findMany({
        where,
        orderBy: { triggeredAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.webhookLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async getOrFail(tenantId: string, id: string): Promise<WebhookRow> {
    const webhook = await this.prisma.webhook.findFirst({
      where: { id, tenantId },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    return webhook as WebhookRow;
  }

  /**
   * Refuses a URL that points inside the perimeter. Kept separate from
   * {@link validateUrl} because it needs DNS and therefore has to be async.
   */
  private async assertTargetAllowed(url: string): Promise<void> {
    try {
      await assertPublicWebhookTarget(url);
    } catch (error) {
      if (error instanceof UnsafeWebhookTargetError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private validateUrl(raw: string): string {
    const value = (raw ?? '').trim();
    if (!value) {
      throw new BadRequestException('A webhook URL is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(
        `"${value}" is not a valid absolute URL`,
      );
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestException(
        'A webhook URL must use http:// or https://',
      );
    }

    return parsed.toString();
  }

  private validateEvents(events: string[]): string[] {
    if (!Array.isArray(events) || events.length === 0) {
      throw new BadRequestException(
        'A webhook must subscribe to at least one event',
      );
    }

    for (const event of events) {
      if (!isWebhookEvent(event)) {
        throw new BadRequestException(`Unknown webhook event: "${event}"`);
      }
    }

    // Two subscriptions to the same event would deliver it twice.
    return Array.from(new Set(events));
  }

  private toView(webhook: WebhookRow): WebhookView {
    return {
      id: webhook.id,
      tenantId: webhook.tenantId,
      url: webhook.url,
      events: webhook.events,
      description: webhook.description,
      isActive: webhook.isActive,
      hasSecret: Boolean(webhook.secret),
      secretHint: webhook.secret ? `••••${webhook.secret.slice(-4)}` : null,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
    };
  }
}
