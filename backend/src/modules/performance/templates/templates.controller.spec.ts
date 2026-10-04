import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { mockHrAdmin } from '../../../test/helpers';

const service = {
  listQuestions: jest.fn(),
  createQuestion: jest.fn(),
  updateQuestion: jest.fn(),
  deleteQuestion: jest.fn(),
  listTemplates: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  deleteTemplate: jest.fn(),
};

describe('TemplatesController', () => {
  let controller: TemplatesController;

  beforeEach(async () => {
    Object.values(service).forEach((fn) => fn.mockReset());
    const moduleRef = await Test.createTestingModule({
      controllers: [TemplatesController],
      providers: [{ provide: TemplatesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(TemplatesController);
  });

  it.each([
    'listQuestions', 'createQuestion', 'updateQuestion', 'deleteQuestion',
    'listTemplates', 'getTemplate', 'createTemplate', 'updateTemplate', 'deleteTemplate',
  ])('%s is admin-only', (method) => {
    const roles = Reflect.getMetadata(ROLES_KEY, (TemplatesController.prototype as any)[method]);
    expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN]);
  });

  it('delegates question routes with the tenant', async () => {
    service.listQuestions.mockResolvedValue([]);
    await controller.listQuestions(mockHrAdmin);
    expect(service.listQuestions).toHaveBeenCalledWith(mockHrAdmin.tenantId);

    const dto = { text: 'x', type: 'TEXT' as any };
    await controller.createQuestion(mockHrAdmin, dto);
    expect(service.createQuestion).toHaveBeenCalledWith(mockHrAdmin.tenantId, dto);

    await controller.updateQuestion(mockHrAdmin, 'q1', { isActive: false });
    expect(service.updateQuestion).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'q1', { isActive: false });

    await controller.deleteQuestion(mockHrAdmin, 'q1');
    expect(service.deleteQuestion).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'q1');
  });

  it('delegates template routes with the tenant', async () => {
    await controller.listTemplates(mockHrAdmin);
    expect(service.listTemplates).toHaveBeenCalledWith(mockHrAdmin.tenantId);

    await controller.getTemplate(mockHrAdmin, 't1');
    expect(service.getTemplate).toHaveBeenCalledWith(mockHrAdmin.tenantId, 't1');

    const dto = { name: 'A', questions: [] };
    await controller.createTemplate(mockHrAdmin, dto);
    expect(service.createTemplate).toHaveBeenCalledWith(mockHrAdmin.tenantId, dto);

    await controller.updateTemplate(mockHrAdmin, 't1', { name: 'B' });
    expect(service.updateTemplate).toHaveBeenCalledWith(mockHrAdmin.tenantId, 't1', { name: 'B' });

    await controller.deleteTemplate(mockHrAdmin, 't1');
    expect(service.deleteTemplate).toHaveBeenCalledWith(mockHrAdmin.tenantId, 't1');
  });
});
