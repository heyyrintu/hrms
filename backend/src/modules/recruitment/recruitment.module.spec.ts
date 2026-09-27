import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../../common/storage/storage.service';
import { EmailService } from '../../common/email/email.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { AuditService } from '../audit/audit.service';
import {
  createMockEmailService,
  createMockNotificationsService,
  createMockPrismaService,
} from '../../test/helpers';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import { RecruitmentModule } from './recruitment.module';
import { PublicCareersController } from './public-careers.controller';
import { ApplicationsService } from './applications.service';

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: createMockPrismaService() },
    { provide: NotificationsService, useValue: createMockNotificationsService() },
    { provide: EmailService, useValue: createMockEmailService() },
    { provide: StorageService, useValue: {} },
    { provide: FieldEncryptionService, useValue: {} },
    { provide: AuditService, useValue: { log: jest.fn() } },
  ],
  exports: [
    PrismaService,
    NotificationsService,
    EmailService,
    StorageService,
    FieldEncryptionService,
    AuditService,
  ],
})
class GlobalStubsModule {}

/**
 * Scaffold guard (Keka wave D): the module and its cross-module imports
 * resolve, and both approval handlers register with the engine.
 */
describe('RecruitmentModule', () => {
  it('compiles and registers the JOB_REQUISITION and OFFER handlers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), GlobalStubsModule, RecruitmentModule],
    }).compile();
    await moduleRef.init();

    const registry = moduleRef.get(WorkflowRegistry);
    expect(registry.find('JOB_REQUISITION')).toBeDefined();
    expect(registry.find('OFFER')).toBeDefined();
    expect(moduleRef.get(PublicCareersController)).toBeInstanceOf(PublicCareersController);
    expect(moduleRef.get(ApplicationsService)).toBeInstanceOf(ApplicationsService);

    await moduleRef.close();
  });
});
