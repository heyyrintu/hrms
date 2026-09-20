import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { NotificationType, WebhookLogStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertPublicWebhookTarget } from './url-safety';

/** How long a single delivery attempt may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Total attempts per webhook per event, including the first one. */
const MAX_ATTEMPTS = 3;

/** Backoff before attempt 2 and attempt 3 respectively. */
const RETRY_BACKOFF_MS = [1_000, 4_000];

/** Response bodies are stored for debugging, not archived — keep them small. */
const MAX_RESPONSE_BODY = 2_000;

interface AttemptResult {
  ok: boolean;
  httpStatus?: number;
  responseBody?: string;
  errorMessage?: string;
}

/**
 * Delivers events to customer-configured HTTP endpoints.
 *
 * Exported from {@link WebhooksModule} so any module can fire an event without
 * knowing anything about webhooks. The contract is deliberately one-way: a
 * dead, slow or hostile customer endpoint must never fail the HR action that
 * triggered it, so `dispatch` swallows every error it meets. Callers get a
 * resolved promise whatever happens.
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Fire `event` at every active webhook in `tenantId` subscribed to it.
   *
   * Never throws. Never rejects. Await it or don't — either is safe.
   */
  async dispatch(
    tenantId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const webhooks = await this.prisma.webhook.findMany({
        where: {
          tenantId,
          isActive: true,
          events: { has: event },
        },
      });

      if (!webhooks || webhooks.length === 0) {
        return;
      }

      const body = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        data: payload,
      });

      for (const webhook of webhooks) {
        await this.deliver(tenantId, webhook, event, payload, body);
      }
    } catch (error) {
      // A failure here means the lookup itself broke. The caller's HR action is
      // still valid, so this is logged and dropped rather than propagated.
      this.logger.error(
        `Webhook dispatch for "${event}" failed before delivery: ${this.describe(error)}`,
      );
    }
  }

  /**
   * Delivers one event to one webhook, retrying with backoff, and writes
   * exactly one log row carrying the final outcome.
   */
  private async deliver(
    tenantId: string,
    webhook: { id: string; url: string; secret: string | null },
    event: string,
    payload: Record<string, unknown>,
    body: string,
  ): Promise<void> {
    const deliveryId = randomUUID();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-HRMS-Event': event,
      'X-HRMS-Delivery': deliveryId,
    };

    if (webhook.secret) {
      headers['X-HRMS-Signature'] = `sha256=${createHmac('sha256', webhook.secret)
        .update(body)
        .digest('hex')}`;
    }

    let attemptCount = 0;
    let last: AttemptResult = { ok: false, errorMessage: 'No attempt was made' };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attemptCount = attempt;
      last = await this.attempt(webhook.url, headers, body);

      if (last.ok) {
        break;
      }

      if (attempt < MAX_ATTEMPTS) {
        await this.sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 1_000);
      }
    }

    await this.writeLog(tenantId, webhook.id, event, payload, {
      status: last.ok ? WebhookLogStatus.SUCCESS : WebhookLogStatus.FAILED,
      httpStatus: last.httpStatus,
      responseBody: last.responseBody,
      errorMessage: last.ok ? undefined : last.errorMessage,
      attemptCount,
    });

    if (!last.ok) {
      await this.notifyFailure(tenantId, webhook.url, event, last);
    }
  }

  /** One HTTP attempt. Any 2xx counts as success. Never throws. */
  private async attempt(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<AttemptResult> {
    try {
      // Checked before every attempt, not just when the webhook was saved: a
      // hostname can resolve publicly on save and to 127.0.0.1 at delivery.
      await assertPublicWebhookTarget(url);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        // Not followed, or a public URL could redirect inside the perimeter.
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      let text = '';
      try {
        text = await response.text();
      } catch {
        // A body that cannot be read does not change the verdict.
        text = '';
      }

      const responseBody = text.slice(0, MAX_RESPONSE_BODY);
      const ok = response.status >= 200 && response.status < 300;

      return {
        ok,
        httpStatus: response.status,
        responseBody,
        errorMessage: ok
          ? undefined
          : response.status >= 300 && response.status < 400
            ? `Endpoint responded ${response.status}; redirects are not followed`
            : `Endpoint responded ${response.status}`,
      };
    } catch (error) {
      return { ok: false, errorMessage: this.describe(error) };
    }
  }

  /**
   * Writes the delivery log. A log write that fails must not turn into a thrown
   * error in the caller, so this is guarded too.
   */
  private async writeLog(
    tenantId: string,
    webhookId: string,
    event: string,
    payload: Record<string, unknown>,
    outcome: {
      status: WebhookLogStatus;
      httpStatus?: number;
      responseBody?: string;
      errorMessage?: string;
      attemptCount: number;
    },
  ) {
    try {
      return await this.prisma.webhookLog.create({
        data: {
          tenantId,
          webhookId,
          event,
          payload: payload as any,
          status: outcome.status,
          httpStatus: outcome.httpStatus ?? null,
          responseBody: outcome.responseBody ?? null,
          errorMessage: outcome.errorMessage ?? null,
          attemptCount: outcome.attemptCount,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not record webhook delivery for ${webhookId}: ${this.describe(error)}`,
      );
      return null;
    }
  }

  private async notifyFailure(
    tenantId: string,
    url: string,
    event: string,
    last: AttemptResult,
  ) {
    try {
      await this.notificationsService.notifyByRole(
        tenantId,
        ['HR_ADMIN', 'SUPER_ADMIN'],
        NotificationType.WEBHOOK_DELIVERY_FAILED,
        'Webhook delivery failed',
        `"${event}" could not be delivered to ${url} after ${MAX_ATTEMPTS} attempts: ${
          last.errorMessage ?? 'unknown error'
        }`,
        '/admin/webhooks',
      );
    } catch (error) {
      this.logger.error(
        `Could not notify admins about the failed webhook: ${this.describe(error)}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private describe(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
