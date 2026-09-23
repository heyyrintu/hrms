import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PipService } from './pip.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
  mockEmployee,
  mockManager,
  mockHrAdmin,
  mockSuperAdmin,
} from '../../test/helpers';
import { NotificationType, PIPStatus, UserRole } from '@prisma/client';

describe('PipService', () => {
  let service: PipService;
  let prisma: any;
  let notificationsService: any;

  const tenantId = 'tenant-1';

  const employeeId = mockEmployee.employeeId as string;
  const managerId = mockManager.employeeId as string;
  const hrId = mockHrAdmin.employeeId as string;

  // UTC noon keeps the date stable regardless of the runner's timezone.
  const startDate = new Date('2025-03-01T12:00:00Z');
  const endDate = new Date('2025-06-01T12:00:00Z');

  const basePlan = {
    id: 'pip-1',
    tenantId,
    employeeId: employeeId,
    managerId: managerId,
    title: 'Improve delivery consistency',
    description: 'Three months of focused work',
    startDate,
    endDate,
    status: PIPStatus.ACTIVE,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
      ],
    }).compile();

    service = module.get<PipService>(PipService);
    prisma = module.get(PrismaService);
    notificationsService = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // create
  // ============================================

  describe('create', () => {
    const dto = {
      employeeId: employeeId,
      title: 'Improve delivery consistency',
      description: 'Three months of focused work',
      startDate: '2025-03-01T12:00:00Z',
      endDate: '2025-06-01T12:00:00Z',
    };

    it('creates a draft plan with goals in one transaction and sends no notification', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: employeeId,
        managerId: managerId,
      });
      prisma.improvementPlan.create.mockResolvedValue({ id: 'pip-1' });
      prisma.improvementPlanGoal.createMany.mockResolvedValue({ count: 2 });
      prisma.improvementPlan.findUnique.mockResolvedValue({
        ...basePlan,
        status: PIPStatus.DRAFT,
      });

      const result = await service.create(
        tenantId,
        managerId,
        UserRole.MANAGER,
        {
          ...dto,
          goals: [
            { description: 'Ship weekly', targetDate: '2025-04-01T12:00:00Z' },
            { description: 'Zero regressions', targetDate: '2025-05-01T12:00:00Z' },
          ],
        },
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.improvementPlan.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          employeeId: employeeId,
          managerId: managerId,
          title: dto.title,
          description: dto.description,
          startDate,
          endDate,
          status: PIPStatus.DRAFT,
        },
      });
      expect(prisma.improvementPlanGoal.createMany).toHaveBeenCalledWith({
        data: [
          {
            planId: 'pip-1',
            description: 'Ship weekly',
            targetDate: new Date('2025-04-01T12:00:00Z'),
          },
          {
            planId: 'pip-1',
            description: 'Zero regressions',
            targetDate: new Date('2025-05-01T12:00:00Z'),
          },
        ],
      });
      expect(notificationsService.notifyEmployee).not.toHaveBeenCalled();
      expect(result).toEqual({ ...basePlan, status: PIPStatus.DRAFT });
    });

    it('notifies the employee with PIP_CREATED when the plan is not a draft', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: employeeId,
        managerId: managerId,
      });
      prisma.improvementPlan.create.mockResolvedValue({ id: 'pip-1' });
      prisma.improvementPlan.findUnique.mockResolvedValue(basePlan);

      await service.create(tenantId, managerId, UserRole.MANAGER, {
        ...dto,
        status: PIPStatus.ACTIVE,
      });

      expect(notificationsService.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        NotificationType.PIP_CREATED,
        'Performance Improvement Plan',
        expect.stringContaining('Improve delivery consistency'),
        '/performance/improvement-plans',
      );
    });

    it('rejects an end date that is not after the start date', async () => {
      await expect(
        service.create(tenantId, managerId, UserRole.MANAGER, {
          ...dto,
          endDate: dto.startDate,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the employee is not in the tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.create(tenantId, managerId, UserRole.MANAGER, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('forbids a manager raising a plan for someone who is not their report', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: employeeId,
        managerId: 'some-other-manager',
      });

      await expect(
        service.create(tenantId, managerId, UserRole.MANAGER, dto),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
    });

    it('lets HR raise a plan for anyone in the tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: employeeId,
        managerId: 'some-other-manager',
      });
      prisma.improvementPlan.create.mockResolvedValue({ id: 'pip-1' });
      prisma.improvementPlan.findUnique.mockResolvedValue(basePlan);

      const result = await service.create(
        tenantId,
        hrId,
        UserRole.HR_ADMIN,
        dto,
      );

      expect(result).toEqual(basePlan);
    });

    describe('plan owner', () => {
      const ownerOfCreate = () =>
        prisma.improvementPlan.create.mock.calls[0][0].data.managerId;

      beforeEach(() => {
        prisma.improvementPlan.create.mockResolvedValue({ id: 'pip-1' });
        prisma.improvementPlan.findUnique.mockResolvedValue(basePlan);
      });

      describe('as a MANAGER', () => {
        it('requires the manager to have an employee profile', async () => {
          prisma.employee.findFirst.mockResolvedValue({ id: employeeId, managerId });

          await expect(
            service.create(tenantId, undefined, UserRole.MANAGER, dto),
          ).rejects.toThrow(new BadRequestException('No employee profile linked to your account'));
          expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
        });

        it('forbids naming someone else as the owner', async () => {
          prisma.employee.findFirst.mockResolvedValue({ id: employeeId, managerId });

          await expect(
            service.create(tenantId, managerId, UserRole.MANAGER, {
              ...dto,
              managerId: 'someone-else',
            }),
          ).rejects.toThrow(ForbiddenException);
          expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
        });

        it('accepts naming themselves, and always owns the plan', async () => {
          prisma.employee.findFirst.mockResolvedValue({ id: employeeId, managerId });

          await service.create(tenantId, managerId, UserRole.MANAGER, { ...dto, managerId });

          expect(ownerOfCreate()).toBe(managerId);
          // No second lookup: the manager is already known to be the report's manager.
          expect(prisma.employee.findFirst).toHaveBeenCalledTimes(1);
        });
      });

      describe('as HR', () => {
        it('uses the owner named in the body when they are an employee of the tenant', async () => {
          prisma.employee.findFirst
            .mockResolvedValueOnce({ id: employeeId, managerId })
            .mockResolvedValueOnce({ id: 'emp-chosen-owner' });

          await service.create(tenantId, hrId, UserRole.HR_ADMIN, {
            ...dto,
            managerId: 'emp-chosen-owner',
          });

          expect(prisma.employee.findFirst).toHaveBeenLastCalledWith({
            where: { id: 'emp-chosen-owner', tenantId },
            select: { id: true },
          });
          expect(ownerOfCreate()).toBe('emp-chosen-owner');
        });

        it('lets a super admin with no employee profile name the owner', async () => {
          prisma.employee.findFirst
            .mockResolvedValueOnce({ id: employeeId, managerId: null })
            .mockResolvedValueOnce({ id: 'emp-chosen-owner' });

          await service.create(tenantId, undefined, UserRole.SUPER_ADMIN, {
            ...dto,
            managerId: 'emp-chosen-owner',
          });

          expect(ownerOfCreate()).toBe('emp-chosen-owner');
        });

        it('rejects an owner who is not an employee of the tenant', async () => {
          prisma.employee.findFirst
            .mockResolvedValueOnce({ id: employeeId, managerId })
            .mockResolvedValueOnce(null);

          await expect(
            service.create(tenantId, hrId, UserRole.HR_ADMIN, {
              ...dto,
              managerId: 'emp-elsewhere',
            }),
          ).rejects.toThrow(BadRequestException);
          expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
        });

        it('rejects making the employee the owner of their own plan', async () => {
          prisma.employee.findFirst.mockResolvedValueOnce({ id: employeeId, managerId });

          await expect(
            service.create(tenantId, hrId, UserRole.HR_ADMIN, {
              ...dto,
              managerId: employeeId,
            }),
          ).rejects.toThrow(BadRequestException);
          expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
        });

        it('defaults to the HR caller when they have an employee profile', async () => {
          prisma.employee.findFirst.mockResolvedValue({ id: employeeId, managerId });

          await service.create(tenantId, hrId, UserRole.HR_ADMIN, dto);

          expect(ownerOfCreate()).toBe(hrId);
        });

        it("falls back to the employee's reporting manager when the caller has no profile", async () => {
          prisma.employee.findFirst.mockResolvedValue({ id: employeeId, managerId });

          await service.create(tenantId, undefined, UserRole.HR_ADMIN, dto);

          expect(ownerOfCreate()).toBe(managerId);
        });

        it('never defaults the owner to the subject: HR raising a plan on themselves gets their manager', async () => {
          prisma.employee.findFirst.mockResolvedValue({ id: hrId, managerId });

          await service.create(tenantId, hrId, UserRole.HR_ADMIN, { ...dto, employeeId: hrId });

          expect(ownerOfCreate()).toBe(managerId);
        });

        it('asks for an owner when there is no caller profile and no reporting manager', async () => {
          prisma.employee.findFirst.mockResolvedValue({ id: employeeId, managerId: null });

          await expect(
            service.create(tenantId, undefined, UserRole.HR_ADMIN, dto),
          ).rejects.toThrow(
            new BadRequestException(
              'Pick a plan owner: this employee has no reporting manager and your account has no employee profile',
            ),
          );
          expect(prisma.improvementPlan.create).not.toHaveBeenCalled();
        });
      });
    });
  });

  // ============================================
  // findAll / findMine / findTeam
  // ============================================

  describe('findAll', () => {
    it('scopes by tenant and applies status and employee filters', async () => {
      prisma.improvementPlan.findMany.mockResolvedValue([basePlan]);
      prisma.improvementPlan.count.mockResolvedValue(1);

      const result = await service.findAll(tenantId, {
        page: 2,
        limit: 5,
        status: PIPStatus.ACTIVE,
        employeeId: employeeId,
      });

      expect(prisma.improvementPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            status: PIPStatus.ACTIVE,
            employeeId: employeeId,
          },
          skip: 5,
          take: 5,
        }),
      );
      expect(result.meta).toEqual({
        total: 1,
        page: 2,
        limit: 5,
        totalPages: 1,
      });
    });
  });

  describe('findMine', () => {
    it('never returns drafts', async () => {
      prisma.improvementPlan.findMany.mockResolvedValue([basePlan]);
      prisma.improvementPlan.count.mockResolvedValue(1);

      await service.findMine(tenantId, employeeId, {});

      expect(prisma.improvementPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            employeeId: employeeId,
            status: { not: PIPStatus.DRAFT },
          },
        }),
      );
    });

    it('returns an empty page when a draft filter is asked for explicitly', async () => {
      const result = await service.findMine(tenantId, employeeId, {
        status: PIPStatus.DRAFT,
      });

      expect(prisma.improvementPlan.findMany).not.toHaveBeenCalled();
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('findTeam', () => {
    it('scopes to plans the caller owns as the manager', async () => {
      prisma.improvementPlan.findMany.mockResolvedValue([]);
      prisma.improvementPlan.count.mockResolvedValue(0);

      await service.findTeam(tenantId, managerId, {
        status: PIPStatus.ACTIVE,
      });

      expect(prisma.improvementPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            managerId: managerId,
            status: PIPStatus.ACTIVE,
          },
        }),
      );
    });
  });

  // ============================================
  // findById
  // ============================================

  describe('findById', () => {
    it('includes goals ordered by target date', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);

      await service.findById(tenantId, 'pip-1', mockManager);

      expect(prisma.improvementPlan.findFirst).toHaveBeenCalledWith({
        where: { id: 'pip-1', tenantId },
        include: expect.objectContaining({
          goals: { orderBy: { targetDate: 'asc' } },
        }),
      });
    });

    it('throws NotFoundException when the plan is not in the tenant', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(null);

      await expect(
        service.findById(tenantId, 'pip-1', mockHrAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets the plan employee see an active plan', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);

      const result = await service.findById(tenantId, 'pip-1', mockEmployee);

      expect(result).toEqual(basePlan);
    });

    it('hides a draft plan from its employee', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue({
        ...basePlan,
        status: PIPStatus.DRAFT,
      });

      await expect(
        service.findById(tenantId, 'pip-1', mockEmployee),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids an unrelated employee', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);

      await expect(
        service.findById(tenantId, 'pip-1', {
          ...mockEmployee,
          employeeId: 'emp-other',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a super admin see any plan', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue({
        ...basePlan,
        status: PIPStatus.DRAFT,
      });

      const result = await service.findById(tenantId, 'pip-1', mockSuperAdmin);

      expect(result.id).toBe('pip-1');
    });
  });

  // ============================================
  // update
  // ============================================

  describe('update', () => {
    it('updates fields and notifies with PIP_UPDATED on a status change', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlan.update.mockResolvedValue({
        ...basePlan,
        status: PIPStatus.COMPLETED,
      });

      await service.update(tenantId, 'pip-1', mockManager, {
        title: 'Renamed plan',
        status: PIPStatus.COMPLETED,
      });

      expect(prisma.improvementPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pip-1' },
          data: { title: 'Renamed plan', status: PIPStatus.COMPLETED },
        }),
      );
      expect(notificationsService.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        NotificationType.PIP_UPDATED,
        'Improvement Plan Updated',
        expect.stringContaining('COMPLETED'),
        '/performance/improvement-plans',
      );
    });

    it('notifies with PIP_CREATED when the plan leaves DRAFT for the first time', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue({
        ...basePlan,
        status: PIPStatus.DRAFT,
      });
      prisma.improvementPlan.update.mockResolvedValue(basePlan);

      await service.update(tenantId, 'pip-1', mockManager, {
        status: PIPStatus.ACTIVE,
      });

      expect(notificationsService.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        NotificationType.PIP_CREATED,
        'Performance Improvement Plan',
        expect.any(String),
        '/performance/improvement-plans',
      );
    });

    it('does not notify when the status is unchanged', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlan.update.mockResolvedValue(basePlan);

      await service.update(tenantId, 'pip-1', mockManager, {
        description: 'Reworded',
      });

      expect(notificationsService.notifyEmployee).not.toHaveBeenCalled();
    });

    it('rejects an end date that lands before the stored start date', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);

      await expect(
        service.update(tenantId, 'pip-1', mockManager, {
          endDate: '2025-02-01T12:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.improvementPlan.update).not.toHaveBeenCalled();
    });

    it('forbids a manager who does not own the plan', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue({
        ...basePlan,
        managerId: 'emp-other-manager',
      });

      await expect(
        service.update(tenantId, 'pip-1', mockManager, {
          status: PIPStatus.TERMINATED,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================
  // goals
  // ============================================

  describe('addGoal', () => {
    it('creates a goal against the plan', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlanGoal.create.mockResolvedValue({ id: 'goal-1' });

      const result = await service.addGoal(tenantId, 'pip-1', mockManager, {
        description: 'Pair twice a week',
        targetDate: '2025-04-15T12:00:00Z',
      });

      expect(prisma.improvementPlanGoal.create).toHaveBeenCalledWith({
        data: {
          planId: 'pip-1',
          description: 'Pair twice a week',
          targetDate: new Date('2025-04-15T12:00:00Z'),
        },
      });
      expect(result).toEqual({ id: 'goal-1' });
    });

    it('forbids an employee adding a goal to their own plan', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);

      await expect(
        service.addGoal(tenantId, 'pip-1', mockEmployee, {
          description: 'Self-set goal',
          targetDate: '2025-04-15T12:00:00Z',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateGoal', () => {
    const goal = {
      id: 'goal-1',
      planId: 'pip-1',
      description: 'Pair twice a week',
      isCompleted: false,
      completedAt: null,
    };

    it('stamps completedAt when the employee ticks a goal off', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlanGoal.findFirst.mockResolvedValue(goal);
      prisma.improvementPlanGoal.update.mockResolvedValue({
        ...goal,
        isCompleted: true,
      });

      await service.updateGoal(tenantId, 'pip-1', 'goal-1', mockEmployee, {
        isCompleted: true,
        notes: 'Done every week since March',
      });

      const call = prisma.improvementPlanGoal.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'goal-1' });
      expect(call.data.isCompleted).toBe(true);
      expect(call.data.notes).toBe('Done every week since March');
      expect(call.data.completedAt).toBeInstanceOf(Date);
    });

    it('clears completedAt when a goal is un-ticked', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlanGoal.findFirst.mockResolvedValue({
        ...goal,
        isCompleted: true,
        completedAt: new Date('2025-04-02T12:00:00Z'),
      });
      prisma.improvementPlanGoal.update.mockResolvedValue({ ...goal });

      await service.updateGoal(tenantId, 'pip-1', 'goal-1', mockManager, {
        isCompleted: false,
      });

      const call = prisma.improvementPlanGoal.update.mock.calls[0][0];
      expect(call.data.isCompleted).toBe(false);
      expect(call.data.completedAt).toBeNull();
    });

    it('forbids the employee rewriting the goal description', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);

      await expect(
        service.updateGoal(tenantId, 'pip-1', 'goal-1', mockEmployee, {
          description: 'Something easier',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets the manager change the goal description and target date', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlanGoal.findFirst.mockResolvedValue(goal);
      prisma.improvementPlanGoal.update.mockResolvedValue(goal);

      await service.updateGoal(tenantId, 'pip-1', 'goal-1', mockManager, {
        description: 'Pair three times a week',
        targetDate: '2025-05-01T12:00:00Z',
      });

      const call = prisma.improvementPlanGoal.update.mock.calls[0][0];
      expect(call.data.description).toBe('Pair three times a week');
      expect(call.data.targetDate).toEqual(new Date('2025-05-01T12:00:00Z'));
    });

    it('throws NotFoundException when the goal is on a different plan', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlanGoal.findFirst.mockResolvedValue(null);

      await expect(
        service.updateGoal(tenantId, 'pip-1', 'goal-9', mockManager, {
          isCompleted: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('forbids an unrelated employee', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);

      await expect(
        service.updateGoal(
          tenantId,
          'pip-1',
          'goal-1',
          { ...mockEmployee, employeeId: 'emp-other' },
          { isCompleted: true },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteGoal', () => {
    it('deletes a goal that belongs to the plan', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlanGoal.findFirst.mockResolvedValue({
        id: 'goal-1',
        planId: 'pip-1',
      });
      prisma.improvementPlanGoal.delete.mockResolvedValue({ id: 'goal-1' });

      const result = await service.deleteGoal(
        tenantId,
        'pip-1',
        'goal-1',
        mockHrAdmin,
      );

      expect(prisma.improvementPlanGoal.delete).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
      });
      expect(result).toEqual({ message: 'Goal deleted' });
    });

    it('throws NotFoundException when the goal is not on that plan', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);
      prisma.improvementPlanGoal.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteGoal(tenantId, 'pip-1', 'goal-9', mockManager),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.improvementPlanGoal.delete).not.toHaveBeenCalled();
    });

    it('forbids the plan employee deleting a goal', async () => {
      prisma.improvementPlan.findFirst.mockResolvedValue(basePlan);

      await expect(
        service.deleteGoal(tenantId, 'pip-1', 'goal-1', mockEmployee),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
