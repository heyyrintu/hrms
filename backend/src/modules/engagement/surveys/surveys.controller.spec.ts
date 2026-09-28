import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';
import { SurveySubmissionService } from './survey-submission.service';
import { SurveyResultsService } from './survey-results.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { AUDIT_ENTITY_KEY } from '../../audit/audit.decorator';

const mockSurveysService = {
  findAll: jest.fn(),
  create: jest.fn(),
  mine: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  launch: jest.fn(),
  close: jest.fn(),
  form: jest.fn(),
};
const mockSubmissionService = { submit: jest.fn() };
const mockResultsService = { results: jest.fn(), namedResponses: jest.fn() };

describe('SurveysController', () => {
  let controller: SurveysController;
  let reflector: Reflector;

  const hrUser: AuthenticatedUser = {
    userId: 'user-hr',
    email: 'hr@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-hr',
  };

  const employeeUser: AuthenticatedUser = {
    userId: 'user-emp',
    email: 'emp@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  const orphanUser: AuthenticatedUser = {
    userId: 'user-orphan',
    email: 'orphan@test.com',
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockSurveysService).forEach((fn) => fn.mockReset());
    Object.values(mockSubmissionService).forEach((fn) => fn.mockReset());
    Object.values(mockResultsService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SurveysController],
      providers: [
        { provide: SurveysService, useValue: mockSurveysService },
        { provide: SurveySubmissionService, useValue: mockSubmissionService },
        { provide: SurveyResultsService, useValue: mockResultsService },
      ],
    }).compile();

    controller = module.get<SurveysController>(SurveysController);
    reflector = new Reflector();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  const hrRouteNames = [
    'findAll',
    'create',
    'findById',
    'update',
    'remove',
    'launch',
    'close',
    'results',
    'namedResponses',
  ] as const;

  it.each(hrRouteNames)('%s is restricted to HR_ADMIN/SUPER_ADMIN', (name) => {
    const roles = reflector.get(ROLES_KEY, (controller as any)[name]);
    expect(roles).toEqual([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]);
  });

  it('mine has no role restriction (all roles)', () => {
    const roles = reflector.get(ROLES_KEY, controller.mine);
    expect(roles).toBeUndefined();
  });

  it('form has no role restriction (all roles)', () => {
    const roles = reflector.get(ROLES_KEY, controller.form);
    expect(roles).toBeUndefined();
  });

  it('submit has no role restriction (all roles)', () => {
    const roles = reflector.get(ROLES_KEY, controller.submit);
    expect(roles).toBeUndefined();
  });

  it('the submit handler carries no @Audit metadata', () => {
    const metadata = Reflect.getMetadata(AUDIT_ENTITY_KEY, controller.submit);
    expect(metadata).toBeUndefined();
  });

  describe('mine', () => {
    it('400s a user with no employee record', async () => {
      await expect(controller.mine(orphanUser)).rejects.toThrow(BadRequestException);
      expect(mockSurveysService.mine).not.toHaveBeenCalled();
    });

    it('delegates to the service for a participant', async () => {
      mockSurveysService.mine.mockResolvedValue([]);
      await controller.mine(employeeUser);
      expect(mockSurveysService.mine).toHaveBeenCalledWith('tenant-1', 'emp-1');
    });
  });

  describe('submit', () => {
    const dto = { answers: [] };

    it('400s without calling the submission service when employeeId is missing', async () => {
      await expect(controller.submit(orphanUser, 'survey-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSubmissionService.submit).not.toHaveBeenCalled();
    });

    it('delegates to SurveySubmissionService', async () => {
      mockSubmissionService.submit.mockResolvedValue({ submitted: true });
      await controller.submit(employeeUser, 'survey-1', dto);
      expect(mockSubmissionService.submit).toHaveBeenCalledWith(
        'tenant-1',
        'emp-1',
        'survey-1',
        dto,
      );
    });
  });

  describe('create', () => {
    it('400s an HR user without an employee record', async () => {
      await expect(controller.create(orphanUser, {} as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockSurveysService.create).not.toHaveBeenCalled();
    });

    it('passes the caller through as createdById', async () => {
      mockSurveysService.create.mockResolvedValue({ id: 'survey-1' });
      const dto = { title: 'Q1' } as any;
      await controller.create(hrUser, dto);
      expect(mockSurveysService.create).toHaveBeenCalledWith('tenant-1', 'emp-hr', dto);
    });
  });

  describe('form', () => {
    it('400s a user with no employee record', async () => {
      await expect(controller.form(orphanUser, 'survey-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
