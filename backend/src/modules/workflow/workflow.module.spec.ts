import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createMockNotificationsService, createMockPrismaService } from '../../test/helpers';
import { WorkflowModule } from './workflow.module';
import { ApprovalEngineService } from './approval-engine.service';
import { WorkflowRegistry } from './workflow-registry.service';
import { ApprovalsController } from './approvals.controller';
import { WorkflowsController } from './workflows.controller';

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: createMockPrismaService() },
    { provide: NotificationsService, useValue: createMockNotificationsService() },
  ],
  exports: [PrismaService, NotificationsService],
})
class GlobalStubsModule {}

describe('WorkflowModule', () => {
  it('wires the engine, registry and both controllers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalStubsModule, WorkflowModule],
    }).compile();

    expect(moduleRef.get(ApprovalEngineService)).toBeInstanceOf(ApprovalEngineService);
    expect(moduleRef.get(WorkflowRegistry)).toBeInstanceOf(WorkflowRegistry);
    expect(moduleRef.get(ApprovalsController)).toBeInstanceOf(ApprovalsController);
    expect(moduleRef.get(WorkflowsController)).toBeInstanceOf(WorkflowsController);
  });
});
