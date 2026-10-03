import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompetenciesController } from './competencies.controller';
import { CompetenciesService } from './competencies.service';
import { CreateCompetencyDto, SetDesignationCompetenciesDto } from './dto/competencies.dto';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';

const mockService = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  getForDesignation: jest.fn(),
  setForDesignation: jest.fn(),
};

const admin: AuthenticatedUser = {
  userId: 'u1',
  email: 'a@test.com',
  tenantId: 't1',
  role: UserRole.HR_ADMIN,
  employeeId: undefined,
};

describe('CompetenciesController', () => {
  let controller: CompetenciesController;

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompetenciesController],
      providers: [{ provide: CompetenciesService, useValue: mockService }],
    }).compile();
    controller = module.get(CompetenciesController);
  });

  it('passes the tenant (not the employee) to every call, so admins without an employee record work', async () => {
    await controller.list(admin);
    await controller.create(admin, { name: 'Teamwork' });
    await controller.update(admin, 'c1', { isActive: false });
    await controller.remove(admin, 'c1');
    await controller.forDesignation(admin, 'd1');
    await controller.setForDesignation(admin, 'd1', { items: [] });
    expect(mockService.list).toHaveBeenCalledWith('t1');
    expect(mockService.create).toHaveBeenCalledWith('t1', { name: 'Teamwork' });
    expect(mockService.update).toHaveBeenCalledWith('t1', 'c1', { isActive: false });
    expect(mockService.remove).toHaveBeenCalledWith('t1', 'c1');
    expect(mockService.getForDesignation).toHaveBeenCalledWith('t1', 'd1');
    expect(mockService.setForDesignation).toHaveBeenCalledWith('t1', 'd1', { items: [] });
  });

  it('every route is admin-only', () => {
    const reflector = new Reflector();
    const routes = ['list', 'create', 'update', 'remove', 'forDesignation', 'setForDesignation'] as const;
    for (const route of routes) {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, CompetenciesController.prototype[route]);
      expect([...roles].sort()).toEqual([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN].sort());
    }
  });

  describe('DTO validation', () => {
    it('CreateCompetencyDto enforces name 1-100', async () => {
      expect(await validate(plainToInstance(CreateCompetencyDto, { name: 'Teamwork' }))).toHaveLength(0);
      expect(await validate(plainToInstance(CreateCompetencyDto, { name: '' }))).not.toHaveLength(0);
      expect(await validate(plainToInstance(CreateCompetencyDto, { name: 'x'.repeat(101) }))).not.toHaveLength(0);
    });

    it('SetDesignationCompetenciesDto validates each item (uuid, level 1-5)', async () => {
      const uuid = '8f0b1a3e-2c4d-4e6f-9a1b-3c5d7e9f0a1b';
      const ok = plainToInstance(SetDesignationCompetenciesDto, { items: [{ competencyId: uuid, expectedLevel: 3 }] });
      expect(await validate(ok)).toHaveLength(0);
      const badLevel = plainToInstance(SetDesignationCompetenciesDto, { items: [{ competencyId: uuid, expectedLevel: 9 }] });
      expect(await validate(badLevel)).not.toHaveLength(0);
      const badId = plainToInstance(SetDesignationCompetenciesDto, { items: [{ competencyId: 'nope', expectedLevel: 3 }] });
      expect(await validate(badId)).not.toHaveLength(0);
    });
  });
});
