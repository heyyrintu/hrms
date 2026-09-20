import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

/**
 * `WebhookDispatcherService` is exported so feature modules (leave, payroll,
 * employees) can fire events without importing anything webhook-shaped beyond
 * this one service.
 */
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcherService],
  exports: [WebhooksService, WebhookDispatcherService],
})
export class WebhooksModule {}
