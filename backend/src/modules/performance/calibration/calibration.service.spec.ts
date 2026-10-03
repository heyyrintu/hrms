import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CalibrationService } from './calibration.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { createMockPrismaService, createMockNotificationsService } from '../../../test/helpers';

const user = (role: UserRole, employeeId: string | undefined): AuthenticatedUser => ({
  userId: `u-${employeeId ?? role}`,
  email: 'x@test.com',
  tenantId: 't1',
  role,
  employeeId,
});
const admin = user(UserRole.HR_ADMIN, 'emp-admin');
const manager = user(UserRole.MANAGER, 'emp-mgr');
const employee = user(UserRole.EMPLOYEE, 'emp-1');
const managerNoEmployee = user(UserRole.MANAGER, undefined);

const review = (over: Record<string, unknown> = {}) => ({
  id: 'rev1',
  tenantId: 't1',
  cycleId: 'c1',
  employeeId: 'emp-1',
  reviewerId: 'emp-mgr',
  status: 'COMPLETED',
  overallRating: 3,
  calibratedRating: null,
  calibrationReason: null,
  cycle: { status: 'ACTIVE' },
  ...over,
});

describe('CalibrationService', () => {
  let service: CalibrationService;
  let prisma: any;
  let audit: { log: jest.Mock };
  let notifications: ReturnType<typeof createMockNotificationsService>;

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    notifications = createMockNotificationsService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalibrationService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(CalibrationService);
    prisma = module.get(PrismaService);
  });

  describe('calibrate', () => {
    const dto = { rating: 4, reason: 'Calibrated against peers in the cycle' };

    beforeEach(() => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ overallRating: 3 }));
      prisma.performanceReview.update.mockImplementation(async ({ data }: any) => ({
        ...review(),
        ...data,
      }));
    });

    it('403s non-admins, before reading anything', async () => {
      await expect(service.calibrate(manager, 'rev1', dto)).rejects.toThrow(ForbiddenException);
      await expect(service.calibrate(employee, 'rev1', dto)).rejects.toThrow(ForbiddenException);
      expect(prisma.performanceReview.findFirst).not.toHaveBeenCalled();
    });

    it('404s a review outside the tenant (queried by tenant) ', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);
      await expect(service.calibrate(admin, 'missing', dto)).rejects.toThrow(NotFoundException);
      expect(prisma.performanceReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'missing', tenantId: 't1' } }),
      );
    });

    // Review Focus 2
    it('403s an admin calibrating their own review', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ employeeId: 'emp-admin' }));
      await expect(service.calibrate(admin, 'rev1', dto)).rejects.toThrow(ForbiddenException);
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    // Review Focus 4
    it('400s unless the review is COMPLETED', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ status: 'MANAGER_REVIEW' }));
      await expect(service.calibrate(admin, 'rev1', dto)).rejects.toThrow(BadRequestException);
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    // Review Focus 4
    it('400s once the cycle is COMPLETED (or not yet ACTIVE)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ cycle: { status: 'COMPLETED' } }));
      await expect(service.calibrate(admin, 'rev1', dto)).rejects.toThrow(BadRequestException);
      prisma.performanceReview.findFirst.mockResolvedValue(review({ cycle: { status: 'DRAFT' } }));
      await expect(service.calibrate(admin, 'rev1', dto)).rejects.toThrow(BadRequestException);
      expect(prisma.performanceReview.update).not.toHaveBeenCalled();
    });

    it('reads the review inside the transaction, before the update and audit row', async () => {
      await service.calibrate(admin, 'rev1', dto);
      const tx = prisma.$transaction.mock.invocationCallOrder[0];
      const read = prisma.performanceReview.findFirst.mock.invocationCallOrder[0];
      const write = prisma.performanceReview.update.mock.invocationCallOrder[0];
      expect(read).toBeGreaterThan(tx);
      expect(read).toBeLessThan(write);
      expect(write).toBeLessThan(audit.log.mock.invocationCallOrder[0]);
    });

    it('sets the override and writes the audit row with the transaction client', async () => {
      const result = await service.calibrate(admin, 'rev1', dto);

      const data = prisma.performanceReview.update.mock.calls[0][0].data;
      expect(data).toMatchObject({
        calibratedRating: 4,
        calibrationReason: dto.reason,
        calibratedById: 'u-emp-admin',
      });
      expect(data.calibratedAt).toBeInstanceOf(Date);

      expect(audit.log).toHaveBeenCalledTimes(1);
      const [input, txArg] = audit.log.mock.calls[0];
      expect(txArg).toBe(prisma); // the callback's tx, not a bare prisma
      expect(input).toEqual({
        tenantId: 't1',
        userId: 'u-emp-admin',
        action: 'UPDATE',
        entityType: 'PerformanceReviewCalibration',
        entityId: 'rev1',
        oldValues: { calibratedRating: null, calibrationReason: null },
        newValues: { calibratedRating: 4, calibrationReason: dto.reason },
      });
      expect(result).toMatchObject({ id: 'rev1', calibratedRating: 4, finalRating: 4 });
    });

    it('records the previous override when revising', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(
        review({ calibratedRating: 4, calibrationReason: 'Earlier reason here' }),
      );
      await service.calibrate(admin, 'rev1', { rating: 2, reason: 'Revised after the panel' });
      expect(audit.log.mock.calls[0][0].oldValues).toEqual({
        calibratedRating: 4,
        calibrationReason: 'Earlier reason here',
      });
      expect(audit.log.mock.calls[0][0].newValues).toEqual({
        calibratedRating: 2,
        calibrationReason: 'Revised after the panel',
      });
    });

    it('reverts with rating null: clears the rating, keeps the revert reason, still audits, final falls back to overall', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(
        review({ calibratedRating: 5, calibrationReason: 'Earlier reason here', overallRating: 3 }),
      );
      const result = await service.calibrate(admin, 'rev1', { rating: null, reason: 'Reverting the override' });
      const data = prisma.performanceReview.update.mock.calls[0][0].data;
      expect(data).toMatchObject({
        calibratedRating: null,
        calibrationReason: 'Reverting the override',
        calibratedById: 'u-emp-admin',
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log.mock.calls[0][0].newValues).toEqual({
        calibratedRating: null,
        calibrationReason: 'Reverting the override',
      });
      expect(result.finalRating).toBe(3);
    });

    it('notifies the reviewer after the commit, and a failed notification does not fail the call', async () => {
      notifications.notifyEmployee.mockRejectedValue(new Error('smtp down'));
      await expect(service.calibrate(admin, 'rev1', dto)).resolves.toBeDefined();
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        't1',
        'emp-mgr',
        'REVIEW_CALIBRATED',
        expect.any(String),
        expect.any(String),
        '/performance/team',
      );
      // after the transaction callback returned
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      expect(notifications.notifyEmployee.mock.invocationCallOrder[0]).toBeGreaterThan(txOrder);
    });

    it('does not notify when the transaction fails', async () => {
      audit.log.mockRejectedValue(new Error('audit failed'));
      await expect(service.calibrate(admin, 'rev1', dto)).rejects.toThrow('audit failed');
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });
  });

  describe('getCalibration', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'r',
      employeeId: 'e',
      reviewerId: 'emp-mgr',
      status: 'COMPLETED',
      managerRating: 3,
      overallRating: 3,
      calibratedRating: null,
      calibrationReason: null,
      potentialRating: null,
      employee: {
        id: 'e',
        firstName: 'Ann',
        lastName: 'Lee',
        employeeCode: 'E1',
        departmentId: 'd1',
        department: { id: 'd1', name: 'Eng' },
      },
      reviewer: { id: 'emp-mgr', firstName: 'Max', lastName: 'Boss' },
      ...over,
    });
    const emp = (id: string, first: string, dept: { id: string; name: string } | null) => ({
      id,
      firstName: first,
      lastName: 'X',
      employeeCode: id,
      departmentId: dept?.id ?? null,
      department: dept,
    });

    beforeEach(() => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'c1', name: 'H1', status: 'ACTIVE' });
      prisma.performanceReview.findMany.mockResolvedValue([]);
    });

    it('403s plain employees, before any query', async () => {
      await expect(service.getCalibration(employee, { cycleId: 'c1' })).rejects.toThrow(ForbiddenException);
      expect(prisma.reviewCycle.findFirst).not.toHaveBeenCalled();
    });

    it('404s a cycle outside the tenant', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);
      await expect(service.getCalibration(admin, { cycleId: 'x' })).rejects.toThrow(NotFoundException);
      expect(prisma.reviewCycle.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'x', tenantId: 't1' } }),
      );
    });

    it('admins query the whole cycle, applying department and manager filters', async () => {
      await service.getCalibration(admin, { cycleId: 'c1', departmentId: 'd1', managerId: 'emp-mgr' });
      expect(prisma.performanceReview.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        cycleId: 'c1',
        employeeId: { not: 'emp-admin' },
        employee: { departmentId: 'd1' },
        reviewerId: 'emp-mgr',
      });
    });

    it('managers only get reviews where they are the reviewer', async () => {
      await service.getCalibration(manager, { cycleId: 'c1' });
      expect(prisma.performanceReview.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        cycleId: 'c1',
        employeeId: { not: 'emp-mgr' },
        reviewerId: 'emp-mgr',
      });
    });

    // Self-view wins
    it('excludes the own review of the caller for admins and managers, and adds no filter without an employee record', async () => {
      await service.getCalibration(admin, { cycleId: 'c1' });
      expect(prisma.performanceReview.findMany.mock.calls[0][0].where.employeeId).toEqual({ not: 'emp-admin' });
      await service.getCalibration(manager, { cycleId: 'c1' });
      expect(prisma.performanceReview.findMany.mock.calls[1][0].where.employeeId).toEqual({ not: 'emp-mgr' });
      await service.getCalibration(user(UserRole.SUPER_ADMIN, undefined), { cycleId: 'c1' });
      expect(prisma.performanceReview.findMany.mock.calls[2][0].where).not.toHaveProperty('employeeId');
    });

    it('a manager filtering by another manager gets nothing, without querying reviews', async () => {
      const result = await service.getCalibration(manager, { cycleId: 'c1', managerId: 'someone-else' });
      expect(prisma.performanceReview.findMany).not.toHaveBeenCalled();
      expect(result.reviews).toEqual([]);
      expect(result.overall.total).toBe(0);
    });

    // Review Focus 5
    it('a manager without an employee record gets 400 and no unscoped review query', async () => {
      await expect(service.getCalibration(managerNoEmployee, { cycleId: 'c1' })).rejects.toThrow(BadRequestException);
      expect(prisma.performanceReview.findMany).not.toHaveBeenCalled();
    });

    it('builds distributions from the final rating (calibrated over overall), counting unrated', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([
        row({ id: 'a', overallRating: 3, calibratedRating: 5 }), // final 5
        row({ id: 'b', overallRating: 3 }), // final 3
        row({ id: 'c', overallRating: 3 }), // final 3
        row({ id: 'd', overallRating: null, calibratedRating: null }), // unrated
      ]);
      const view = await service.getCalibration(admin, { cycleId: 'c1' });
      expect(view.overall).toEqual({ '1': 0, '2': 0, '3': 2, '4': 0, '5': 1, unrated: 1, total: 4 });
      expect(view.cycle).toEqual({ id: 'c1', name: 'H1', status: 'ACTIVE' });
    });

    it('groups by department (null -> "No department") and by reviewer, both sorted by name', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([
        row({ id: 'a', employee: emp('e1', 'A', { id: 'd2', name: 'Sales' }), reviewerId: 'm2', reviewer: { id: 'm2', firstName: 'Zed', lastName: 'Z' }, overallRating: 4 }),
        row({ id: 'b', employee: emp('e2', 'B', null), reviewerId: 'm1', reviewer: { id: 'm1', firstName: 'Amy', lastName: 'A' }, overallRating: 2 }),
        row({ id: 'c', employee: emp('e3', 'C', { id: 'd1', name: 'Eng' }), reviewerId: 'm1', reviewer: { id: 'm1', firstName: 'Amy', lastName: 'A' }, overallRating: 4 }),
      ]);
      const view = await service.getCalibration(admin, { cycleId: 'c1' });
      expect(view.byDepartment.map((d) => d.departmentName)).toEqual(['Eng', 'No department', 'Sales']);
      expect(view.byDepartment[1]).toMatchObject({ departmentId: null });
      expect(view.byDepartment[0].distribution).toMatchObject({ '4': 1, total: 1 });
      expect(view.byManager.map((m) => m.reviewerName)).toEqual(['Amy A', 'Zed Z']);
      expect(view.byManager[0].distribution).toMatchObject({ '2': 1, '4': 1, total: 2 });
    });

    it('returns one row per review with the final rating', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([
        row({ id: 'a', overallRating: 3, calibratedRating: 5, calibrationReason: 'Top performer', potentialRating: 3 }),
      ]);
      const view = await service.getCalibration(admin, { cycleId: 'c1' });
      expect(view.reviews[0]).toEqual({
        reviewId: 'a',
        employeeId: 'e',
        employeeName: 'Ann Lee',
        employeeCode: 'E1',
        departmentName: 'Eng',
        reviewerName: 'Max Boss',
        status: 'COMPLETED',
        managerRating: 3,
        overallRating: 3,
        calibratedRating: 5,
        calibrationReason: 'Top performer',
        finalRating: 5,
        potentialRating: 3,
      });
    });
  });

  describe('getNineBox', () => {
    const person = (id: string, name: string, designation: string | null, dept: string | null) => ({
      id,
      firstName: name,
      lastName: 'Z',
      employeeCode: id,
      departmentId: dept ? 'd' : null,
      department: dept ? { id: 'd', name: dept } : null,
      designation: designation ? { name: designation } : null,
    });
    const nb = (id: string, over: Record<string, unknown>, who = person(`e-${id}`, id, 'Dev', 'Eng')) => ({
      id,
      employeeId: who.id,
      overallRating: 3,
      calibratedRating: null,
      potentialRating: 2,
      employee: who,
      ...over,
    });
    const cell = (view: any, performance: string, potential: string) =>
      view.cells.find((c: any) => c.performance === performance && c.potential === potential);

    beforeEach(() => {
      prisma.reviewCycle.findFirst.mockResolvedValue({ id: 'c1', name: 'H1', status: 'ACTIVE' });
      prisma.performanceReview.findMany.mockResolvedValue([]);
    });

    it('403s plain employees', async () => {
      await expect(service.getNineBox(employee, { cycleId: 'c1' })).rejects.toThrow(ForbiddenException);
    });

    it('scopes managers to their reviewees and admins to the cycle (with department filter)', async () => {
      await service.getNineBox(manager, { cycleId: 'c1', departmentId: 'd1' });
      expect(prisma.performanceReview.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        cycleId: 'c1',
        employeeId: { not: 'emp-mgr' },
        reviewerId: 'emp-mgr',
        employee: { departmentId: 'd1' },
      });
      await service.getNineBox(admin, { cycleId: 'c1' });
      expect(prisma.performanceReview.findMany.mock.calls[1][0].where).toEqual({
        tenantId: 't1',
        cycleId: 'c1',
        employeeId: { not: 'emp-admin' },
      });
    });

    // Review Focus 5
    it('a manager without an employee record gets 400, not an unscoped query', async () => {
      await expect(service.getNineBox(managerNoEmployee, { cycleId: 'c1' })).rejects.toThrow(BadRequestException);
      expect(prisma.performanceReview.findMany).not.toHaveBeenCalled();
    });

    // Self-view wins
    it('excludes the own review of the caller for admins and managers', async () => {
      await service.getNineBox(admin, { cycleId: 'c1' });
      expect(prisma.performanceReview.findMany.mock.calls[0][0].where.employeeId).toEqual({ not: 'emp-admin' });
      await service.getNineBox(manager, { cycleId: 'c1' });
      expect(prisma.performanceReview.findMany.mock.calls[1][0].where.employeeId).toEqual({ not: 'emp-mgr' });
      await service.getNineBox(user(UserRole.HR_ADMIN, undefined), { cycleId: 'c1' });
      expect(prisma.performanceReview.findMany.mock.calls[2][0].where).not.toHaveProperty('employeeId');
    });

    it('always returns nine cells: potential HIGH to LOW rows, performance LOW to HIGH columns', async () => {
      const view = await service.getNineBox(admin, { cycleId: 'c1' });
      expect(view.cells).toHaveLength(9);
      expect(view.cells.map((c) => `${c.potential}/${c.performance}`)).toEqual([
        'HIGH/LOW', 'HIGH/MEDIUM', 'HIGH/HIGH',
        'MEDIUM/LOW', 'MEDIUM/MEDIUM', 'MEDIUM/HIGH',
        'LOW/LOW', 'LOW/MEDIUM', 'LOW/HIGH',
      ]);
      expect(view.cells.every((c) => c.employees.length === 0)).toBe(true);
      expect(view.missing).toEqual([]);
    });

    it('places people by final-rating band and potential band', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([
        nb('a', { overallRating: 2, potentialRating: 1 }), // LOW / LOW
        nb('b', { overallRating: 3, potentialRating: 2 }), // MEDIUM / MEDIUM
        nb('c', { overallRating: 4, potentialRating: 3 }), // HIGH / HIGH
        nb('d', { overallRating: 3, calibratedRating: 5, potentialRating: 3 }), // calibrated wins: HIGH / HIGH
        nb('e', { overallRating: 5, calibratedRating: 1, potentialRating: 3 }), // calibrated down: LOW perf / HIGH pot
      ]);
      const view = await service.getNineBox(admin, { cycleId: 'c1' });
      expect(cell(view, 'LOW', 'LOW').employees.map((p: any) => p.reviewId)).toEqual(['a']);
      expect(cell(view, 'MEDIUM', 'MEDIUM').employees.map((p: any) => p.reviewId)).toEqual(['b']);
      expect(cell(view, 'HIGH', 'HIGH').employees.map((p: any) => p.reviewId).sort()).toEqual(['c', 'd']);
      expect(cell(view, 'LOW', 'HIGH').employees.map((p: any) => p.reviewId)).toEqual(['e']);
      expect(cell(view, 'LOW', 'LOW').employees[0]).toEqual({
        reviewId: 'a',
        employeeId: 'e-a',
        name: 'a Z',
        designation: 'Dev',
        departmentName: 'Eng',
        finalRating: 2,
        potentialRating: 1,
      });
    });

    it('sends reviews missing a final rating or a potential to `missing`', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([
        nb('a', { overallRating: null, potentialRating: 2 }),
        nb('b', { overallRating: 4, potentialRating: null }),
        nb('c', { overallRating: null, potentialRating: null }),
        nb('d', { overallRating: 4, potentialRating: 3 }),
      ]);
      const view = await service.getNineBox(admin, { cycleId: 'c1' });
      expect(view.missing).toEqual([
        { reviewId: 'a', employeeId: 'e-a', name: 'a Z', missingRating: true, missingPotential: false },
        { reviewId: 'b', employeeId: 'e-b', name: 'b Z', missingRating: false, missingPotential: true },
        { reviewId: 'c', employeeId: 'e-c', name: 'c Z', missingRating: true, missingPotential: true },
      ]);
      expect(view.cells.flatMap((c) => c.employees)).toHaveLength(1);
    });

    it('carries null designation and department through', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([
        nb('a', {}, person('e-a', 'a', null, null)),
      ]);
      const view = await service.getNineBox(admin, { cycleId: 'c1' });
      expect(cell(view, 'MEDIUM', 'MEDIUM').employees[0]).toMatchObject({ designation: null, departmentName: null });
    });
  });
});
