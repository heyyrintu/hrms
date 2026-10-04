import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PeerReviewsService } from './peer-reviews/peer-reviews.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const cycleOf = (o: Record<string, any> = {}) => ({
  id: 'cycle-1',
  name: 'Q1',
  status: 'ACTIVE',
  peerFeedbackEnabled: false,
  maxPeers: 5,
  ...o,
});

const reviewOf = (o: Record<string, any> = {}) => ({
  id: 'rev-1',
  tenantId: 'tenant-1',
  cycleId: 'cycle-1',
  employeeId: 'emp-1',
  reviewerId: 'emp-mgr',
  status: 'PENDING',
  managerRating: 4,
  overallRating: 4,
  potentialRating: 2,
  calibratedRating: null,
  cycle: cycleOf(),
  answers: [],
  competencyRatings: [],
  ...o,
});

const userOf = (role: string, employeeId: string | undefined): AuthenticatedUser => ({
  userId: `user-${employeeId ?? 'none'}`,
  email: 'u@test.com',
  tenantId: 'tenant-1',
  role: role as any,
  employeeId,
});

describe('PerformanceService', () => {
  let service: PerformanceService;
  let prisma: any;
  let notifications: any;
  let peerReviews: { anonymousFeedback: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        { provide: PeerReviewsService, useValue: { anonymousFeedback: jest.fn() } },
      ],
    }).compile();

    service = module.get<PerformanceService>(PerformanceService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
    peerReviews = module.get(PeerReviewsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // Review Cycles
  // ============================================

  describe('getCycles', () => {
    it('should return paginated cycles', async () => {
      const cycles = [{ id: 'cycle-1', name: 'Q1 2024' }];
      prisma.reviewCycle.findMany.mockResolvedValue(cycles);
      prisma.reviewCycle.count.mockResolvedValue(1);

      const result = await service.getCycles('tenant-1', {});

      expect(prisma.reviewCycle.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
        include: { _count: { select: { reviews: true } } },
      });
      expect(result).toEqual({
        data: cycles,
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('should filter by status', async () => {
      prisma.reviewCycle.findMany.mockResolvedValue([]);
      prisma.reviewCycle.count.mockResolvedValue(0);

      await service.getCycles('tenant-1', { status: 'ACTIVE' as any });

      expect(prisma.reviewCycle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', status: 'ACTIVE' },
        }),
      );
    });
  });

  describe('getCycle', () => {
    it('should return a cycle by id', async () => {
      const cycle = { id: 'cycle-1', tenantId: 'tenant-1', name: 'Q1 2024' };
      prisma.reviewCycle.findFirst.mockResolvedValue(cycle);

      const result = await service.getCycle('tenant-1', 'cycle-1');
      expect(result).toEqual(cycle);
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);

      await expect(service.getCycle('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createCycle', () => {
    it('should create a review cycle', async () => {
      const created = {
        id: 'cycle-1',
        tenantId: 'tenant-1',
        name: 'Q1 2024',
        status: 'DRAFT',
      };
      prisma.reviewCycle.create.mockResolvedValue(created);

      const result = await service.createCycle('tenant-1', {
        name: 'Q1 2024',
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(prisma.reviewCycle.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          name: 'Q1 2024',
          description: undefined,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-03-31'),
        },
        include: { _count: { select: { reviews: true } } },
      });
      expect(result).toEqual(created);
    });

    it('should throw BadRequestException when endDate is before startDate', async () => {
      await expect(
        service.createCycle('tenant-1', {
          name: 'Bad Cycle',
          startDate: '2024-06-01',
          endDate: '2024-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateCycle', () => {
    it('should update a DRAFT cycle', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        tenantId: 'tenant-1',
        status: 'DRAFT',
      });
      const updated = { id: 'cycle-1', name: 'Updated' };
      prisma.reviewCycle.update.mockResolvedValue(updated);

      const result = await service.updateCycle('tenant-1', 'cycle-1', { name: 'Updated' });

      expect(prisma.reviewCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { name: 'Updated' },
        include: { _count: { select: { reviews: true } } },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCycle('tenant-1', 'missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when cycle not DRAFT', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        status: 'ACTIVE',
      });

      await expect(
        service.updateCycle('tenant-1', 'cycle-1', { name: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteCycle', () => {
    it('should delete a DRAFT cycle', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        tenantId: 'tenant-1',
        status: 'DRAFT',
      });
      prisma.reviewCycle.delete.mockResolvedValue({});

      const result = await service.deleteCycle('tenant-1', 'cycle-1');

      expect(prisma.reviewCycle.delete).toHaveBeenCalledWith({ where: { id: 'cycle-1' } });
      expect(result).toEqual({ message: 'Review cycle deleted' });
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);

      await expect(service.deleteCycle('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when cycle not DRAFT', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        status: 'ACTIVE',
      });

      await expect(service.deleteCycle('tenant-1', 'cycle-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // Cycle template / 360 settings
  // ============================================

  describe('cycle template and peer settings', () => {
    const base = { name: 'Q1', startDate: '2024-01-01', endDate: '2024-03-31' };

    it('createCycle stores templateId, peerFeedbackEnabled and maxPeers', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', isActive: true });
      prisma.reviewCycle.create.mockResolvedValue({ id: 'cycle-1' });

      await service.createCycle('tenant-1', {
        ...base, templateId: 'tpl-1', peerFeedbackEnabled: true, maxPeers: 4,
      });

      expect(prisma.reviewTemplate.findFirst).toHaveBeenCalledWith({ where: { id: 'tpl-1', tenantId: 'tenant-1' } });
      expect(prisma.reviewCycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ templateId: 'tpl-1', peerFeedbackEnabled: true, maxPeers: 4 }),
        }),
      );
    });

    it('createCycle 404s for a template outside the tenant and 400s for an inactive one', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      await expect(service.createCycle('tenant-1', { ...base, templateId: 'tpl-x' })).rejects.toThrow(NotFoundException);

      prisma.reviewTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', isActive: false });
      await expect(service.createCycle('tenant-1', { ...base, templateId: 'tpl-1' })).rejects.toThrow(BadRequestException);
      expect(prisma.reviewCycle.create).not.toHaveBeenCalled();
    });

    it('updateCycle validates a new template and can clear it with null', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-1', status: 'DRAFT' });
      prisma.reviewTemplate.findFirst.mockResolvedValue({ id: 'tpl-1', isActive: true });
      prisma.reviewCycle.update.mockResolvedValue({ id: 'cycle-1' });

      await service.updateCycle('tenant-1', 'cycle-1', { templateId: 'tpl-1', maxPeers: 2 });
      expect(prisma.reviewCycle.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { templateId: 'tpl-1', maxPeers: 2 } }),
      );

      prisma.reviewTemplate.findFirst.mockClear();
      await service.updateCycle('tenant-1', 'cycle-1', { templateId: null });
      expect(prisma.reviewTemplate.findFirst).not.toHaveBeenCalled();
      expect(prisma.reviewCycle.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { templateId: null } }),
      );
    });

    it('updateCycle rejects an inactive or foreign template', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-1', status: 'DRAFT' });
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      await expect(service.updateCycle('tenant-1', 'cycle-1', { templateId: 'x' })).rejects.toThrow(NotFoundException);
      prisma.reviewTemplate.findFirst.mockResolvedValue({ id: 'x', isActive: false });
      await expect(service.updateCycle('tenant-1', 'cycle-1', { templateId: 'x' })).rejects.toThrow(BadRequestException);
    });

    it('updateCycle still refuses a non-DRAFT cycle (peer settings are DRAFT-only)', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE' });
      await expect(service.updateCycle('tenant-1', 'cycle-1', { maxPeers: 2 })).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // launchCycle - Complex: uses $transaction
  // ============================================

  describe('launchCycle', () => {
    const draft = { id: 'cycle-1', tenantId: 'tenant-1', name: 'Q1 2024', status: 'DRAFT', templateId: null };

    it('should launch a DRAFT cycle and create reviews for active employees with managers', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(draft);
      const employees = [
        { id: 'emp-1', managerId: 'emp-mgr-1', designationId: null },
        { id: 'emp-2', managerId: 'emp-mgr-2', designationId: null },
      ];
      prisma.employee.findMany.mockResolvedValue(employees);
      const updatedCycle = { ...draft, status: 'ACTIVE', _count: { reviews: 2 } };
      prisma.reviewCycle.update.mockResolvedValue(updatedCycle);
      prisma.performanceReview.createManyAndReturn.mockResolvedValue([
        { id: 'rev-1', employeeId: 'emp-1' },
        { id: 'rev-2', employeeId: 'emp-2' },
      ]);

      const result = await service.launchCycle('tenant-1', 'cycle-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', status: 'ACTIVE', managerId: { not: null } },
        select: { id: true, managerId: true, designationId: true },
      });
      expect(prisma.reviewCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: 'ACTIVE' },
        include: { _count: { select: { reviews: true } } },
      });
      expect(prisma.performanceReview.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          { tenantId: 'tenant-1', cycleId: 'cycle-1', employeeId: 'emp-1', reviewerId: 'emp-mgr-1' },
          { tenantId: 'tenant-1', cycleId: 'cycle-1', employeeId: 'emp-2', reviewerId: 'emp-mgr-2' },
        ],
        select: { id: true, employeeId: true },
      });
      expect(result).toEqual({ ...updatedCycle, reviewsCreated: 2 });
    });

    it('no template -> no question snapshot', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(draft);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', managerId: 'm', designationId: null }]);
      prisma.reviewCycle.update.mockResolvedValue({ ...draft, status: 'ACTIVE' });
      prisma.performanceReview.createManyAndReturn.mockResolvedValue([{ id: 'rev-1', employeeId: 'emp-1' }]);

      await service.launchCycle('tenant-1', 'cycle-1');

      expect(prisma.reviewTemplateQuestion.findMany).not.toHaveBeenCalled();
      expect(prisma.reviewCycleQuestion.createMany).not.toHaveBeenCalled();
    });

    it('snapshots the template questions (text, type, audience, required, order) in the launch transaction', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ ...draft, templateId: 'tpl-1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', managerId: 'm', designationId: null }]);
      prisma.reviewCycle.update.mockResolvedValue({ ...draft, status: 'ACTIVE' });
      prisma.performanceReview.createManyAndReturn.mockResolvedValue([{ id: 'rev-1', employeeId: 'emp-1' }]);
      prisma.reviewTemplateQuestion.findMany.mockResolvedValue([
        { questionId: 'q1', audience: 'SELF', isRequired: true, sortOrder: 0, question: { text: 'Teamwork', type: 'RATING' } },
        { questionId: 'q2', audience: 'MANAGER', isRequired: false, sortOrder: 1, question: { text: 'Strengths', type: 'TEXT' } },
      ]);

      await service.launchCycle('tenant-1', 'cycle-1');

      // inactive questions are excluded by the query itself
      expect(prisma.reviewTemplateQuestion.findMany).toHaveBeenCalledWith({
        where: { templateId: 'tpl-1', question: { isActive: true } },
        include: { question: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(prisma.reviewCycleQuestion.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId: 'tenant-1', cycleId: 'cycle-1', questionId: 'q1', text: 'Teamwork', type: 'RATING', audience: 'SELF', isRequired: true, sortOrder: 0 },
          { tenantId: 'tenant-1', cycleId: 'cycle-1', questionId: 'q2', text: 'Strengths', type: 'TEXT', audience: 'MANAGER', isRequired: false, sortOrder: 1 },
        ],
      });
    });

    it('a template whose questions are all inactive snapshots nothing', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ ...draft, templateId: 'tpl-1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', managerId: 'm', designationId: null }]);
      prisma.reviewCycle.update.mockResolvedValue({ ...draft, status: 'ACTIVE' });
      prisma.performanceReview.createManyAndReturn.mockResolvedValue([{ id: 'rev-1', employeeId: 'emp-1' }]);
      prisma.reviewTemplateQuestion.findMany.mockResolvedValue([]);

      await service.launchCycle('tenant-1', 'cycle-1');

      expect(prisma.reviewCycleQuestion.createMany).not.toHaveBeenCalled();
    });

    it('snapshots one competency row per review and mapped active competency; designation-less employees get none', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(draft);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', managerId: 'm', designationId: 'des-1' },
        { id: 'emp-2', managerId: 'm', designationId: 'des-1' },
        { id: 'emp-3', managerId: 'm', designationId: null },
      ]);
      prisma.reviewCycle.update.mockResolvedValue({ ...draft, status: 'ACTIVE' });
      prisma.performanceReview.createManyAndReturn.mockResolvedValue([
        { id: 'rev-1', employeeId: 'emp-1' },
        { id: 'rev-2', employeeId: 'emp-2' },
        { id: 'rev-3', employeeId: 'emp-3' },
      ]);
      prisma.designationCompetency.findMany.mockResolvedValue([
        { designationId: 'des-1', competencyId: 'c1', expectedLevel: 3, competency: { id: 'c1', name: 'Leadership' } },
        { designationId: 'des-1', competencyId: 'c2', expectedLevel: 4, competency: { id: 'c2', name: 'Delivery' } },
      ]);

      await service.launchCycle('tenant-1', 'cycle-1');

      expect(prisma.designationCompetency.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', designationId: { in: ['des-1'] }, competency: { isActive: true } },
        include: { competency: { select: { id: true, name: true } } },
      });
      const rows = prisma.reviewCompetencyRating.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(4);
      expect(rows.map((r: any) => r.reviewId).sort()).toEqual(['rev-1', 'rev-1', 'rev-2', 'rev-2']);
      expect(rows).toContainEqual({
        tenantId: 'tenant-1', reviewId: 'rev-1', competencyId: 'c2', name: 'Delivery', expectedLevel: 4,
      });
    });

    it('no designations at all -> no competency lookup and no rows', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(draft);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', managerId: 'm', designationId: null }]);
      prisma.reviewCycle.update.mockResolvedValue({ ...draft, status: 'ACTIVE' });
      prisma.performanceReview.createManyAndReturn.mockResolvedValue([{ id: 'rev-1', employeeId: 'emp-1' }]);

      await service.launchCycle('tenant-1', 'cycle-1');

      expect(prisma.designationCompetency.findMany).not.toHaveBeenCalled();
      expect(prisma.reviewCompetencyRating.createMany).not.toHaveBeenCalled();
    });

    it('a designation with no active mapped competency creates no rows', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(draft);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', managerId: 'm', designationId: 'des-1' }]);
      prisma.reviewCycle.update.mockResolvedValue({ ...draft, status: 'ACTIVE' });
      prisma.performanceReview.createManyAndReturn.mockResolvedValue([{ id: 'rev-1', employeeId: 'emp-1' }]);
      prisma.designationCompetency.findMany.mockResolvedValue([]);

      await service.launchCycle('tenant-1', 'cycle-1');

      expect(prisma.reviewCompetencyRating.createMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);
      await expect(service.launchCycle('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when cycle not DRAFT', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE' });
      await expect(service.launchCycle('tenant-1', 'cycle-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when no eligible employees found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(draft);
      prisma.employee.findMany.mockResolvedValue([]);
      await expect(service.launchCycle('tenant-1', 'cycle-1')).rejects.toThrow(BadRequestException);
    });

    it('should notify all employees after launch', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ ...draft, name: 'Q1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1', managerId: 'mgr-1', designationId: null }]);
      prisma.reviewCycle.update.mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE', _count: { reviews: 1 } });
      prisma.performanceReview.createManyAndReturn.mockResolvedValue([{ id: 'rev-1', employeeId: 'emp-1' }]);

      await service.launchCycle('tenant-1', 'cycle-1');

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1', 'emp-1', expect.any(String), 'Performance Review Cycle Launched',
        expect.stringContaining('Q1'), '/performance',
      );
    });
  });

  // ============================================
  // completeCycle
  // ============================================

  describe('completeCycle', () => {
    it('should complete an ACTIVE cycle', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-1', tenantId: 'tenant-1', name: 'Q1', status: 'ACTIVE' });
      const updated = { id: 'cycle-1', status: 'COMPLETED' };
      prisma.reviewCycle.update.mockResolvedValue(updated);
      prisma.performanceReview.findMany.mockResolvedValue([]);

      const result = await service.completeCycle('tenant-1', 'cycle-1');

      expect(prisma.reviewCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: 'COMPLETED' },
        include: { _count: { select: { reviews: true } } },
      });
      expect(result).toEqual(updated);
    });

    it('notifies each employee with a COMPLETED review that results are released', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-1', tenantId: 'tenant-1', name: 'Q1', status: 'ACTIVE' });
      prisma.reviewCycle.update.mockResolvedValue({ id: 'cycle-1', status: 'COMPLETED' });
      prisma.performanceReview.findMany.mockResolvedValue([{ employeeId: 'emp-1' }, { employeeId: 'emp-2' }]);

      await service.completeCycle('tenant-1', 'cycle-1');

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith({
        where: { cycleId: 'cycle-1', tenantId: 'tenant-1', status: 'COMPLETED' },
        select: { employeeId: true },
      });
      expect(notifications.notifyEmployee).toHaveBeenCalledTimes(2);
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1', 'emp-1', 'REVIEW_RESULTS_RELEASED', 'Performance review results released',
        expect.stringContaining('Q1'), '/performance',
      );
    });

    it('a failing notification does not fail completion', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-1', tenantId: 'tenant-1', name: 'Q1', status: 'ACTIVE' });
      prisma.reviewCycle.update.mockResolvedValue({ id: 'cycle-1', status: 'COMPLETED' });
      prisma.performanceReview.findMany.mockResolvedValue([{ employeeId: 'emp-1' }]);
      notifications.notifyEmployee.mockRejectedValue(new Error('smtp down'));

      await expect(service.completeCycle('tenant-1', 'cycle-1')).resolves.toBeDefined();
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);
      await expect(service.completeCycle('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when cycle not ACTIVE', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'cycle-1', status: 'DRAFT' });
      await expect(service.completeCycle('tenant-1', 'cycle-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // Review views
  // ============================================

  describe('getMyReviews', () => {
    it('should return paginated reviews for employee', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([reviewOf()]);
      prisma.performanceReview.count.mockResolvedValue(1);

      const result = await service.getMyReviews('tenant-1', 'emp-1', {});

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
        include: expect.objectContaining({
          cycle: expect.any(Object),
          reviewer: expect.any(Object),
          _count: expect.any(Object),
          answers: expect.any(Object),
          competencyRatings: expect.any(Object),
        }),
      });
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('shapes every row as the SELF view: no rating or potential before release', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([
        reviewOf({ managerComments: 'private', calibratedRating: 5 }),
      ]);
      prisma.performanceReview.count.mockResolvedValue(1);

      const { data } = await service.getMyReviews('tenant-1', 'emp-1', {});

      const row = data[0] as any;
      expect(row.relation).toBe('SELF');
      expect(row.released).toBe(false);
      for (const k of ['managerRating', 'overallRating', 'calibratedRating', 'potentialRating', 'managerComments', 'finalRating']) {
        expect(k in row).toBe(false);
      }
    });

    it('shows finalRating after release and adds the anonymous block only when 360 is enabled', async () => {
      prisma.performanceReview.count.mockResolvedValue(2);
      prisma.performanceReview.findMany.mockResolvedValue([
        reviewOf({ id: 'a', cycle: cycleOf({ status: 'COMPLETED', peerFeedbackEnabled: true }), calibratedRating: 5 }),
        reviewOf({ id: 'b', cycle: cycleOf({ status: 'COMPLETED', peerFeedbackEnabled: false }) }),
      ]);
      peerReviews.anonymousFeedback.mockResolvedValue({ peerFeedback: null, peerFeedbackHiddenReason: 'TOO_FEW_RESPONSES' });

      const { data } = await service.getMyReviews('tenant-1', 'emp-1', {});

      expect(peerReviews.anonymousFeedback).toHaveBeenCalledTimes(1);
      expect(peerReviews.anonymousFeedback).toHaveBeenCalledWith('a', true);
      expect((data[0] as any).finalRating).toBe(5);
      expect((data[0] as any).peerFeedbackHiddenReason).toBe('TOO_FEW_RESPONSES');
      expect('peerFeedback' in (data[1] as any)).toBe(false);
    });

    it('should filter by status and cycleId', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([]);
      prisma.performanceReview.count.mockResolvedValue(0);

      await service.getMyReviews('tenant-1', 'emp-1', { status: 'PENDING' as any, cycleId: 'cycle-1' });

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', employeeId: 'emp-1', status: 'PENDING', cycleId: 'cycle-1' },
        }),
      );
    });
  });

  describe('getReview', () => {
    const full = (o: Record<string, any> = {}) =>
      reviewOf({
        status: 'COMPLETED',
        managerComments: 'good',
        employee: { id: 'emp-1' },
        reviewer: { id: 'emp-mgr' },
        goals: [],
        ...o,
      });

    it('the employee gets the SELF view', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(full());
      const result: any = await service.getReview(userOf('EMPLOYEE', 'emp-1'), 'rev-1');
      expect(result.relation).toBe('SELF');
      expect('overallRating' in result).toBe(false);
      expect('potentialRating' in result).toBe(false);
    });

    it('the reviewer gets everything', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(full());
      const result: any = await service.getReview(userOf('MANAGER', 'emp-mgr'), 'rev-1');
      expect(result.relation).toBe('REVIEWER');
      expect(result.managerRating).toBe(4);
      expect(result.potentialRating).toBe(2);
      expect(result.managerComments).toBe('good');
    });

    it.each(['HR_ADMIN', 'SUPER_ADMIN'])('%s gets the ADMIN view of any review', async (role) => {
      prisma.performanceReview.findFirst.mockResolvedValue(full());
      const result: any = await service.getReview(userOf(role, 'other-emp'), 'rev-1');
      expect(result.relation).toBe('ADMIN');
      expect(result.overallRating).toBe(4);
    });

    it('an admin opening their own review gets the employee view: no rating before release, no potential, no calibration (Review Focus 2)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(
        full({ employeeId: 'emp-hr', status: 'SELF_REVIEW', calibratedRating: 5, calibrationReason: 'x', calibratedById: 'u', calibratedAt: new Date() }),
      );
      const result: any = await service.getReview(userOf('HR_ADMIN', 'emp-hr'), 'rev-1');
      expect(result.relation).toBe('SELF');
      for (const k of [
        'finalRating', 'managerRating', 'overallRating', 'calibratedRating', 'calibrationReason',
        'calibratedAt', 'calibratedById', 'potentialRating', 'managerComments',
      ]) {
        expect(k in result).toBe(false);
      }
    });

    it('queries by id and tenant', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(full());
      await service.getReview(userOf('EMPLOYEE', 'emp-1'), 'rev-1');
      expect(prisma.performanceReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rev-1', tenantId: 'tenant-1' } }),
      );
    });

    it('should throw NotFoundException when review not found', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);
      await expect(service.getReview(userOf('EMPLOYEE', 'emp-1'), 'missing')).rejects.toThrow(NotFoundException);
    });

    it('a stranger gets 404, not 403 (no existence leak)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(full());
      await expect(service.getReview(userOf('EMPLOYEE', 'stranger'), 'rev-1')).rejects.toThrow(NotFoundException);
      await expect(service.getReview(userOf('MANAGER', 'other-mgr'), 'rev-1')).rejects.toThrow(NotFoundException);
    });

    it('a user without an employee record who is not an admin gets 404', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(full());
      await expect(service.getReview(userOf('EMPLOYEE', undefined), 'rev-1')).rejects.toThrow(NotFoundException);
    });

    it('SELF gets the anonymous peer block when 360 is enabled; reviewer and admin do not', async () => {
      const r = full({ cycle: cycleOf({ status: 'COMPLETED', peerFeedbackEnabled: true }) });
      prisma.performanceReview.findFirst.mockResolvedValue(r);
      peerReviews.anonymousFeedback.mockResolvedValue({ peerFeedback: { submittedCount: 3, questions: [], comments: [] } });

      const self: any = await service.getReview(userOf('EMPLOYEE', 'emp-1'), 'rev-1');
      expect(peerReviews.anonymousFeedback).toHaveBeenCalledWith('rev-1', true);
      expect(self.peerFeedback.submittedCount).toBe(3);

      peerReviews.anonymousFeedback.mockClear();
      const mgr: any = await service.getReview(userOf('MANAGER', 'emp-mgr'), 'rev-1');
      const adm: any = await service.getReview(userOf('HR_ADMIN', 'other'), 'rev-1');
      expect(peerReviews.anonymousFeedback).not.toHaveBeenCalled();
      expect('peerFeedback' in mgr).toBe(false);
      expect('peerFeedback' in adm).toBe(false);
    });

    it('before release the block says NOT_RELEASED', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(
        full({ status: 'SELF_REVIEW', cycle: cycleOf({ peerFeedbackEnabled: true }) }),
      );
      peerReviews.anonymousFeedback.mockResolvedValue({ peerFeedback: null, peerFeedbackHiddenReason: 'NOT_RELEASED' });
      const self: any = await service.getReview(userOf('EMPLOYEE', 'emp-1'), 'rev-1');
      expect(peerReviews.anonymousFeedback).toHaveBeenCalledWith('rev-1', false);
      expect(self.peerFeedbackHiddenReason).toBe('NOT_RELEASED');
    });
  });

  describe('getReviewQuestions', () => {
    beforeEach(() => {
      prisma.reviewCycleQuestion.findMany.mockResolvedValue([]);
    });

    it('404s for missing reviews and strangers', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);
      await expect(service.getReviewQuestions(userOf('EMPLOYEE', 'emp-1'), 'x')).rejects.toThrow(NotFoundException);
      prisma.performanceReview.findFirst.mockResolvedValue(reviewOf());
      await expect(service.getReviewQuestions(userOf('EMPLOYEE', 'stranger'), 'rev-1')).rejects.toThrow(NotFoundException);
    });

    it('SELF gets only SELF questions before release', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(reviewOf());
      await service.getReviewQuestions(userOf('EMPLOYEE', 'emp-1'), 'rev-1');
      expect(prisma.reviewCycleQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { cycleId: 'cycle-1', tenantId: 'tenant-1', audience: { in: ['SELF'] } },
        }),
      );
    });

    it('SELF also gets MANAGER questions after release', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(reviewOf({ cycle: cycleOf({ status: 'COMPLETED' }) }));
      await service.getReviewQuestions(userOf('EMPLOYEE', 'emp-1'), 'rev-1');
      expect(prisma.reviewCycleQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { cycleId: 'cycle-1', tenantId: 'tenant-1', audience: { in: ['SELF', 'MANAGER'] } },
        }),
      );
    });

    it('an admin opening their own review gets the SELF question set', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(reviewOf({ employeeId: 'emp-hr' }));
      await service.getReviewQuestions(userOf('HR_ADMIN', 'emp-hr'), 'rev-1');
      expect(prisma.reviewCycleQuestion.findMany.mock.calls[0][0].where.audience).toEqual({ in: ['SELF'] });
    });

    it.each([
      ['REVIEWER', 'MANAGER', 'emp-mgr'],
      ['ADMIN', 'HR_ADMIN', 'other'],
    ])('%s gets all audiences', async (_n, role, emp) => {
      prisma.performanceReview.findFirst.mockResolvedValue(reviewOf());
      await service.getReviewQuestions(userOf(role, emp), 'rev-1');
      expect(prisma.reviewCycleQuestion.findMany.mock.calls[0][0].where).toEqual({
        cycleId: 'cycle-1', tenantId: 'tenant-1',
      });
    });
  });

  // ============================================
  // submitSelfReview
  // ============================================

  describe('submitSelfReview', () => {
    const pending = (o: Record<string, any> = {}) => reviewOf({ status: 'PENDING', ...o });
    const selfQuestions = [
      { id: 'q1', type: 'RATING', audience: 'SELF', isRequired: true },
      { id: 'q2', type: 'TEXT', audience: 'SELF', isRequired: false },
    ];

    beforeEach(() => {
      prisma.reviewCycleQuestion.findMany.mockResolvedValue([]);
      prisma.performanceReview.update.mockImplementation(async ({ data }: any) => ({
        ...pending(), ...data, answers: [], reviewer: { id: 'emp-mgr' },
      }));
    });

    it('stores answers and the status change in one transaction and returns the SELF view', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(pending());
      prisma.reviewCycleQuestion.findMany.mockResolvedValue(selfQuestions);

      const result: any = await service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', {
        selfRating: 4,
        selfComments: 'Good quarter',
        answers: [{ cycleQuestionId: 'q1', rating: 5 }],
      });

      expect(prisma.performanceReview.findFirst).toHaveBeenCalledWith({
        where: { id: 'rev-1', tenantId: 'tenant-1', employeeId: 'emp-1' },
        include: { cycle: { select: { id: true, name: true, status: true } } },
      });
      expect(prisma.reviewCycleQuestion.findMany).toHaveBeenCalledWith({
        where: { cycleId: 'cycle-1', tenantId: 'tenant-1', audience: 'SELF' },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.reviewAnswer.deleteMany).toHaveBeenCalledWith({
        where: { reviewId: 'rev-1', tenantId: 'tenant-1', audience: 'SELF' },
      });
      expect(prisma.reviewAnswer.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: 'tenant-1', reviewId: 'rev-1', cycleQuestionId: 'q1', audience: 'SELF', rating: 5, text: null }],
      });
      expect(prisma.performanceReview.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rev-1' },
          data: {
            selfRating: 4,
            selfComments: 'Good quarter',
            selfSubmittedAt: expect.any(Date),
            status: 'SELF_REVIEW',
          },
        }),
      );
      expect(result.relation).toBe('SELF');
      expect('overallRating' in result).toBe(false);
    });

    it('without a template (no questions, no answers) it still works and writes no answers', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(pending());
      await service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', { selfRating: 3 });
      expect(prisma.reviewAnswer.createMany).not.toHaveBeenCalled();
      expect(prisma.performanceReview.update).toHaveBeenCalled();
    });

    it('400s and writes nothing when a required question is unanswered', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(pending());
      prisma.reviewCycleQuestion.findMany.mockResolvedValue(selfQuestions);

      await expect(
        service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', { selfRating: 3, answers: [] }),
      ).rejects.toThrow('Please answer every required question');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    it('400s on an unknown question id', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(pending());
      await expect(
        service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', {
          selfRating: 3, answers: [{ cycleQuestionId: 'nope', rating: 3 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('400s once the cycle is COMPLETED and writes nothing (Review Focus 4)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(pending({ cycle: cycleOf({ status: 'COMPLETED' }) }));
      await expect(
        service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', { selfRating: 3 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.reviewAnswer.deleteMany).not.toHaveBeenCalled();
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    it('400s when the cycle is not ACTIVE (DRAFT)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(pending({ cycle: cycleOf({ status: 'DRAFT' }) }));
      await expect(
        service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', { selfRating: 3 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when review not found', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);
      await expect(
        service.submitSelfReview('tenant-1', 'missing', 'emp-1', { selfRating: 4, selfComments: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when review not PENDING', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(pending({ status: 'SELF_REVIEW' }));
      await expect(
        service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', { selfRating: 4, selfComments: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should notify the reviewer after self-review submission', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(pending());
      await service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', { selfRating: 4, selfComments: 'Good' });
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1', 'emp-mgr', expect.any(String), 'Self-Review Submitted',
        expect.stringContaining('Q1'), '/performance/team',
      );
    });
  });

  // ============================================
  // Team Reviews
  // ============================================

  describe('getTeamReviews', () => {
    it('should return all reviews for HR_ADMIN', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([]);
      prisma.performanceReview.count.mockResolvedValue(0);

      const result = await service.getTeamReviews('tenant-1', 'emp-hr', 'HR_ADMIN' as any, {});

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
      );
      expect(result.meta.total).toBe(0);
    });

    it('should scope to reviewerId for MANAGER', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([]);
      prisma.performanceReview.count.mockResolvedValue(0);

      await service.getTeamReviews('tenant-1', 'emp-mgr', 'MANAGER' as any, {});

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1', reviewerId: 'emp-mgr' } }),
      );
    });

    it('should throw BadRequestException when MANAGER has no employeeId', async () => {
      await expect(service.getTeamReviews('tenant-1', undefined, 'MANAGER' as any, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.performanceReview.findMany).not.toHaveBeenCalled();
    });

    it('includes answers and competency ratings in the rows', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([]);
      prisma.performanceReview.count.mockResolvedValue(0);
      await service.getTeamReviews('tenant-1', 'emp-mgr', 'MANAGER' as any, {});
      const include = prisma.performanceReview.findMany.mock.calls[0][0].include;
      expect(include.answers).toBeDefined();
      expect(include.competencyRatings).toBeDefined();
      expect(include.cycle.select.peerFeedbackEnabled).toBe(true);
    });

    it('a manager sees REVIEWER rows including potential and ratings', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([reviewOf()]);
      prisma.performanceReview.count.mockResolvedValue(1);
      const { data } = await service.getTeamReviews('tenant-1', 'emp-mgr', 'MANAGER' as any, {});
      expect((data[0] as any).relation).toBe('REVIEWER');
      expect((data[0] as any).potentialRating).toBe(2);
    });

    it('an admin sees ADMIN rows, but their own review in the list is the SELF view (Review Focus 2)', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([
        reviewOf({ id: 'other' }),
        reviewOf({ id: 'own', employeeId: 'emp-hr' }),
      ]);
      prisma.performanceReview.count.mockResolvedValue(2);

      const { data } = await service.getTeamReviews('tenant-1', 'emp-hr', 'HR_ADMIN' as any, {});

      const [other, own] = data as any[];
      expect(other.relation).toBe('ADMIN');
      expect(other.managerRating).toBe(4);
      expect(own.relation).toBe('SELF');
      expect('managerRating' in own).toBe(false);
      expect('potentialRating' in own).toBe(false);
    });

    it('an admin without an employee record sees ADMIN rows', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([reviewOf()]);
      prisma.performanceReview.count.mockResolvedValue(1);
      const { data } = await service.getTeamReviews('tenant-1', undefined, 'SUPER_ADMIN' as any, {});
      expect((data[0] as any).relation).toBe('ADMIN');
    });
  });

  // ============================================
  // submitManagerReview
  // ============================================

  describe('submitManagerReview', () => {
    const selfReviewed = (o: Record<string, any> = {}) =>
      reviewOf({
        status: 'SELF_REVIEW',
        employee: { id: 'emp-1', firstName: 'John', lastName: 'Doe' },
        competencyRatings: [],
        ...o,
      });
    const dto = { managerRating: 4, managerComments: 'Good work', overallRating: 4 };
    const mgrQuestions = [
      { id: 'mq1', type: 'RATING', audience: 'MANAGER', isRequired: true },
      { id: 'sq1', type: 'RATING', audience: 'SELF', isRequired: true },
    ];

    beforeEach(() => {
      prisma.reviewCycleQuestion.findMany.mockResolvedValue([]);
      prisma.performanceReview.update.mockImplementation(async ({ data }: any) => ({
        ...selfReviewed(), ...data, answers: [], competencyRatings: [],
      }));
    });

    const submit = (emp: string | undefined, role: string, body: any = dto, rev = selfReviewed()) => {
      prisma.performanceReview.findFirst.mockResolvedValue(rev);
      return service.submitManagerReview('tenant-1', 'rev-1', emp, role as any, body);
    };

    it('submits for a SELF_REVIEW review and returns the REVIEWER view', async () => {
      const result: any = await submit('emp-mgr', 'MANAGER');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.performanceReview.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rev-1' },
          data: {
            managerRating: 4,
            managerComments: 'Good work',
            overallRating: 4,
            managerSubmittedAt: expect.any(Date),
            status: 'COMPLETED',
          },
        }),
      );
      expect(result.relation).toBe('REVIEWER');
      expect(result.managerRating).toBe(4);
    });

    it('stores potentialRating when given and writes MANAGER answers (after clearing the old ones)', async () => {
      prisma.reviewCycleQuestion.findMany.mockResolvedValue(mgrQuestions);

      await submit('emp-mgr', 'MANAGER', {
        ...dto, potentialRating: 3, answers: [{ cycleQuestionId: 'mq1', rating: 4 }],
      });

      expect(prisma.reviewCycleQuestion.findMany).toHaveBeenCalledWith({
        where: { cycleId: 'cycle-1', tenantId: 'tenant-1', audience: 'MANAGER' },
      });
      expect(prisma.reviewAnswer.deleteMany).toHaveBeenCalledWith({
        where: { reviewId: 'rev-1', tenantId: 'tenant-1', audience: 'MANAGER' },
      });
      expect(prisma.reviewAnswer.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: 'tenant-1', reviewId: 'rev-1', cycleQuestionId: 'mq1', audience: 'MANAGER', rating: 4, text: null }],
      });
      expect(prisma.performanceReview.update.mock.calls[0][0].data.potentialRating).toBe(3);
    });

    it('leaves potentialRating untouched when omitted', async () => {
      await submit('emp-mgr', 'MANAGER');
      expect('potentialRating' in prisma.performanceReview.update.mock.calls[0][0].data).toBe(false);
    });

    it.each([0, 4, 1.5])('400s on potentialRating %p', async (potentialRating) => {
      await expect(submit('emp-mgr', 'MANAGER', { ...dto, potentialRating })).rejects.toThrow(BadRequestException);
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    it('400s and writes nothing when a required MANAGER question is unanswered', async () => {
      prisma.reviewCycleQuestion.findMany.mockResolvedValue(mgrQuestions);
      await expect(submit('emp-mgr', 'MANAGER')).rejects.toThrow('Please answer every required question');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    it('400s when answering a SELF question as manager', async () => {
      prisma.reviewCycleQuestion.findMany.mockResolvedValue(mgrQuestions);
      await expect(
        submit('emp-mgr', 'MANAGER', { ...dto, answers: [{ cycleQuestionId: 'mq1', rating: 3 }, { cycleQuestionId: 'sq1', rating: 3 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    describe('competency ratings', () => {
      const rows = { competencyRatings: [{ id: 'cr1' }, { id: 'cr2' }] };

      it('must cover exactly the review rows; writes each in the transaction', async () => {
        await submit('emp-mgr', 'MANAGER', {
          ...dto,
          competencyRatings: [{ id: 'cr1', rating: 4, comment: 'strong' }, { id: 'cr2', rating: 2 }],
        }, selfReviewed(rows));

        expect(prisma.reviewCompetencyRating.update).toHaveBeenCalledTimes(2);
        expect(prisma.reviewCompetencyRating.update).toHaveBeenCalledWith({
          where: { id: 'cr1' }, data: { managerRating: 4, comment: 'strong' },
        });
        expect(prisma.reviewCompetencyRating.update).toHaveBeenCalledWith({
          where: { id: 'cr2' }, data: { managerRating: 2, comment: null },
        });
      });

      it.each([
        ['missing one', [{ id: 'cr1', rating: 4 }]],
        ['omitted entirely', undefined],
        ['unknown id', [{ id: 'cr1', rating: 4 }, { id: 'cr9', rating: 3 }]],
        ['duplicate id', [{ id: 'cr1', rating: 4 }, { id: 'cr1', rating: 3 }]],
        ['rating 0', [{ id: 'cr1', rating: 0 }, { id: 'cr2', rating: 3 }]],
        ['rating 6', [{ id: 'cr1', rating: 6 }, { id: 'cr2', rating: 3 }]],
      ])('400s when %s and writes nothing', async (_n, competencyRatings) => {
        await expect(
          submit('emp-mgr', 'MANAGER', { ...dto, competencyRatings }, selfReviewed(rows)),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.reviewCompetencyRating.update).not.toHaveBeenCalled();
        expect(prisma.performanceReview.update).not.toHaveBeenCalled();
      });

      it('a review with no competency rows rejects supplied ratings (unknown ids)', async () => {
        await expect(
          submit('emp-mgr', 'MANAGER', { ...dto, competencyRatings: [{ id: 'cr1', rating: 3 }] }),
        ).rejects.toThrow(BadRequestException);
      });

      it('a review with no competency rows needs none', async () => {
        await expect(submit('emp-mgr', 'MANAGER')).resolves.toBeDefined();
        expect(prisma.reviewCompetencyRating.update).not.toHaveBeenCalled();
      });
    });

    it('should throw NotFoundException when review not found', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);
      await expect(
        service.submitManagerReview('tenant-1', 'missing', 'emp-mgr', 'MANAGER' as any, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when review not SELF_REVIEW', async () => {
      await expect(submit('emp-mgr', 'MANAGER', dto, selfReviewed({ status: 'PENDING' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('400s once the cycle is COMPLETED, even for an admin (Review Focus 4)', async () => {
      const completed = selfReviewed({ cycle: cycleOf({ status: 'COMPLETED' }) });
      await expect(submit('emp-mgr', 'MANAGER', dto, completed)).rejects.toThrow(BadRequestException);
      await expect(submit('emp-hr', 'HR_ADMIN', dto, completed)).rejects.toThrow(BadRequestException);
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
      expect(prisma.reviewAnswer.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when non-admin is not the assigned reviewer', async () => {
      await expect(submit('stranger', 'MANAGER')).rejects.toThrow(ForbiddenException);
    });

    it('403s for a user without an employee record who is not an admin', async () => {
      await expect(submit(undefined, 'MANAGER')).rejects.toThrow(ForbiddenException);
    });

    it('403s an admin acting on their own review', async () => {
      await expect(
        submit('emp-hr', 'HR_ADMIN', dto, selfReviewed({ employeeId: 'emp-hr' })),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    it.each([['HR_ADMIN', 'emp-hr'], ['SUPER_ADMIN', 'emp-admin'], ['SUPER_ADMIN', undefined]])(
      'allows %s (%s) to submit another employee review',
      async (role, emp) => {
        const result: any = await submit(emp as any, role);
        expect(result.relation).toBe('ADMIN');
      },
    );

    it('notifies the employee without the rating', async () => {
      await submit('emp-mgr', 'MANAGER');
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1',
        'emp-1',
        expect.any(String),
        'Performance Review Completed',
        'Your manager has completed your review. Results are released when the cycle closes.',
        '/performance',
      );
      const message = notifications.notifyEmployee.mock.calls[0][4];
      expect(message).not.toMatch(/\d\/5|rating/i);
    });
  });

  // ============================================
  // setPotential
  // ============================================

  describe('setPotential', () => {
    beforeEach(() => {
      prisma.performanceReview.findFirst.mockResolvedValue(reviewOf({ status: 'SELF_REVIEW' }));
      prisma.performanceReview.update.mockImplementation(async ({ data }: any) => ({
        ...reviewOf(), ...data, answers: [], competencyRatings: [],
      }));
    });

    it('lets the reviewer set it while the cycle is ACTIVE', async () => {
      const result: any = await service.setPotential(userOf('MANAGER', 'emp-mgr'), 'rev-1', 3);
      expect(prisma.performanceReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rev-1', tenantId: 'tenant-1' } }),
      );
      expect(prisma.performanceReview.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rev-1' }, data: { potentialRating: 3 } }),
      );
      expect(result.relation).toBe('REVIEWER');
      expect(result.potentialRating).toBe(3);
    });

    it('lets an admin set it on someone else review', async () => {
      const result: any = await service.setPotential(userOf('HR_ADMIN', 'emp-hr'), 'rev-1', 1);
      expect(result.relation).toBe('ADMIN');
    });

    it('404s when the review is missing', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);
      await expect(service.setPotential(userOf('HR_ADMIN', 'emp-hr'), 'x', 2)).rejects.toThrow(NotFoundException);
    });

    it('403s on the own review, including an admin own review (Review Focus 2)', async () => {
      await expect(service.setPotential(userOf('EMPLOYEE', 'emp-1'), 'rev-1', 2)).rejects.toThrow(ForbiddenException);
      prisma.performanceReview.findFirst.mockResolvedValue(reviewOf({ employeeId: 'emp-hr' }));
      await expect(service.setPotential(userOf('HR_ADMIN', 'emp-hr'), 'rev-1', 2)).rejects.toThrow(ForbiddenException);
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    it('403s for a manager who is not the reviewer', async () => {
      await expect(service.setPotential(userOf('MANAGER', 'other-mgr'), 'rev-1', 2)).rejects.toThrow(ForbiddenException);
    });

    it('400s once the cycle is COMPLETED (Review Focus 4)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(reviewOf({ cycle: cycleOf({ status: 'COMPLETED' }) }));
      await expect(service.setPotential(userOf('HR_ADMIN', 'emp-hr'), 'rev-1', 2)).rejects.toThrow(BadRequestException);
      await expect(service.setPotential(userOf('MANAGER', 'emp-mgr'), 'rev-1', 2)).rejects.toThrow(BadRequestException);
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    it.each([0, 4, 2.5])('400s on potential %p', async (value) => {
      await expect(service.setPotential(userOf('MANAGER', 'emp-mgr'), 'rev-1', value)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
