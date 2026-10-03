import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GoalsService } from './goals.service';
import { GoalProgressService } from './goal-progress.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { createMockPrismaService } from '../../../test/helpers';

const dec = (n: number) => ({ toString: () => String(n), valueOf: () => n }) as any;

const user = (role: UserRole, employeeId: string | undefined, userId = `u-${employeeId ?? role}`): AuthenticatedUser => ({
  userId,
  email: `${userId}@test.com`,
  tenantId: 't1',
  role,
  employeeId,
});
const owner = user(UserRole.EMPLOYEE, 'emp-1');
const manager = user(UserRole.MANAGER, 'emp-mgr');
const stranger = user(UserRole.EMPLOYEE, 'emp-9');
const admin = user(UserRole.HR_ADMIN, 'emp-admin');
const adminNoEmployee = user(UserRole.HR_ADMIN, undefined);
const managerNoEmployee = user(UserRole.MANAGER, undefined);

/** A goal row the way GOAL_INCLUDE loads it. */
const goalRec = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  tenantId: 't1',
  ownerType: 'EMPLOYEE',
  employeeId: 'emp-1',
  departmentId: null,
  parentGoalId: null,
  reviewId: null,
  title: 'Learn TS',
  description: null,
  targetDate: new Date('2026-06-30T12:00:00Z'),
  status: 'NOT_STARTED',
  progress: 0,
  weight: dec(1),
  shareOnFeed: false,
  completedAt: null,
  review: null,
  employee: { id: 'emp-1', firstName: 'Ann', lastName: 'Lee', managerId: 'emp-mgr' },
  department: null,
  keyResults: [] as any[],
  _count: { children: 0 },
  children: [] as any[],
  ...over,
});
const companyGoal = (over: Record<string, unknown> = {}) =>
  goalRec({ id: 'co1', ownerType: 'COMPANY', employeeId: null, employee: null, ...over });
const deptGoal = (over: Record<string, unknown> = {}) =>
  goalRec({
    id: 'd1',
    ownerType: 'DEPARTMENT',
    employeeId: null,
    employee: null,
    departmentId: 'dep1',
    department: { id: 'dep1', name: 'Eng' },
    ...over,
  });
const kr = (over: Record<string, unknown> = {}) => ({
  id: 'kr1',
  tenantId: 't1',
  goalId: 'g1',
  title: 'KR',
  metricType: 'NUMBER',
  startValue: dec(0),
  targetValue: dec(100),
  currentValue: dec(0),
  unit: null,
  weight: dec(1),
  progress: 0,
  sortOrder: 0,
  ...over,
});

describe('GoalsService', () => {
  let service: GoalsService;
  let prisma: any;
  let progress: { recomputeChain: jest.Mock; postCompletion: jest.Mock };

  beforeEach(async () => {
    progress = {
      recomputeChain: jest.fn().mockResolvedValue(undefined),
      postCompletion: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: GoalProgressService, useValue: progress },
      ],
    }).compile();

    service = module.get<GoalsService>(GoalsService);
    prisma = module.get(PrismaService);
  });

  // ============================================
  // Reads
  // ============================================

  describe('list / getMyGoals', () => {
    it('mine: scopes to the caller\'s own employee goals', async () => {
      prisma.goal.findMany.mockResolvedValue([goalRec()]);
      const result = await service.getMyGoals(owner);
      expect(prisma.goal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', ownerType: 'EMPLOYEE', employeeId: 'emp-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(1);
    });

    // Review Focus 5
    it('mine: 400 without an employee profile, before any query', async () => {
      await expect(service.list(adminNoEmployee, { scope: 'mine' })).rejects.toThrow(BadRequestException);
      expect(prisma.goal.findMany).not.toHaveBeenCalled();
    });

    it('team: admins see every employee goal in the tenant', async () => {
      prisma.goal.findMany.mockResolvedValue([]);
      await service.list(admin, { scope: 'team' });
      expect(prisma.goal.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', ownerType: 'EMPLOYEE' });
    });

    it('team: managers see their direct reports\' goals', async () => {
      prisma.goal.findMany.mockResolvedValue([]);
      await service.list(manager, { scope: 'team' });
      expect(prisma.goal.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        ownerType: 'EMPLOYEE',
        employee: { managerId: 'emp-mgr' },
      });
    });

    // Review Focus 5
    it('team: a manager without an employee record gets 400, never an unscoped query', async () => {
      await expect(service.list(managerNoEmployee, { scope: 'team' })).rejects.toThrow(BadRequestException);
      expect(prisma.goal.findMany).not.toHaveBeenCalled();
    });

    it('team: plain employees get 403', async () => {
      await expect(service.list(owner, { scope: 'team' })).rejects.toThrow(ForbiddenException);
    });

    it('company and department scopes filter by owner type (and department)', async () => {
      prisma.goal.findMany.mockResolvedValue([]);
      await service.list(owner, { scope: 'company' });
      expect(prisma.goal.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', ownerType: 'COMPANY' });
      await service.list(owner, { scope: 'department', departmentId: 'dep1' });
      expect(prisma.goal.findMany.mock.calls[1][0].where).toEqual({
        tenantId: 't1',
        ownerType: 'DEPARTMENT',
        departmentId: 'dep1',
      });
    });

    it('maps Decimals to numbers, computes isDerived/canEdit and hides the manager link', async () => {
      prisma.goal.findMany.mockResolvedValue([
        goalRec({ weight: dec(2.5), keyResults: [kr({ startValue: dec(1), targetValue: dec(9), currentValue: dec(3), weight: dec(2) })] }),
        goalRec({ id: 'g2', _count: { children: 2 }, children: [{ ownerType: 'EMPLOYEE' }, { ownerType: 'EMPLOYEE' }], review: { id: 'r', status: 'COMPLETED', cycle: { id: 'c', name: 'C' } } }),
        goalRec({ id: 'g3' }),
      ]);
      const [a, b, c] = (await service.list(owner, { scope: 'mine' })) as any[];
      expect(a.weight).toBe(2.5);
      expect(a.keyResults[0]).toMatchObject({ startValue: 1, targetValue: 9, currentValue: 3, weight: 2 });
      expect(a.isDerived).toBe(true);
      expect(a.canEdit).toBe(true);
      expect(a.employee).toEqual({ id: 'emp-1', firstName: 'Ann', lastName: 'Lee' });
      expect(b.isDerived).toBe(true); // has children
      expect(b.canEdit).toBe(false); // locked by a completed review
      expect(c.isDerived).toBe(false);
      expect(a._count).toBeUndefined();
      expect(a.children).toBeUndefined(); // the raw child rows stay server-side
    });

    it('isDerived ignores employee children of an org goal but not of an employee goal', async () => {
      const empKids = [{ ownerType: 'EMPLOYEE' }];
      prisma.goal.findMany.mockResolvedValue([
        companyGoal({ _count: { children: 1 }, children: empKids }),
        deptGoal({ _count: { children: 1 }, children: empKids }),
        companyGoal({ id: 'co2', _count: { children: 1 }, children: [{ ownerType: 'DEPARTMENT' }] }),
        goalRec({ id: 'e1', _count: { children: 1 }, children: empKids }),
      ]);
      const out = (await service.list(admin, { scope: 'company' })) as any[];
      expect(out.map((g) => g.isDerived)).toEqual([false, false, true, true]);
    });

    it('locks a goal whose review cycle is COMPLETED even if the review is not', async () => {
      prisma.goal.findMany.mockResolvedValue([
        goalRec({ review: { id: 'r', status: 'MANAGER_REVIEW', cycle: { id: 'c', name: 'C', status: 'COMPLETED' } } }),
      ]);
      const [a] = (await service.list(owner, { scope: 'mine' })) as any[];
      expect(a.canEdit).toBe(false);
    });
  });

  describe('getGoal', () => {
    it('lets a manager read a direct report\'s goal', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(goalRec());
      prisma.goal.findMany.mockResolvedValue([]);
      const result = await service.getGoal(manager, 'g1');
      expect(result.id).toBe('g1');
      expect(result.canEdit).toBe(false);
    });

    it('404s for a peer reading another employee\'s goal', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(goalRec());
      await expect(service.getGoal(stranger, 'g1')).rejects.toThrow(NotFoundException);
    });

    it('lets an admin read an employee goal but not edit it', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(goalRec());
      prisma.goal.findMany.mockResolvedValue([]);
      const result = await service.getGoal(admin, 'g1');
      expect(result.canEdit).toBe(false);
    });

    it('404s for a missing goal and queries by tenant', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(null);
      await expect(service.getGoal(owner, 'nope')).rejects.toThrow(NotFoundException);
      expect(prisma.goal.findFirst.mock.calls[0][0].where).toEqual({ id: 'nope', tenantId: 't1' });
    });

    it('returns the readable parent and only readable children', async () => {
      prisma.goal.findFirst
        .mockResolvedValueOnce(deptGoal({ parentGoalId: 'co1' }))
        .mockResolvedValueOnce(companyGoal());
      prisma.goal.findMany.mockResolvedValue([
        goalRec({ id: 'mine' }),
        goalRec({ id: 'theirs', employeeId: 'emp-9', employee: { id: 'emp-9', firstName: 'X', lastName: 'Y', managerId: 'other' } }),
      ]);
      const result: any = await service.getGoal(owner, 'd1');
      expect(result.parent.id).toBe('co1');
      expect(result.children.map((c: any) => c.id)).toEqual(['mine']);
    });

    it('drops a parent the caller cannot read', async () => {
      prisma.goal.findFirst
        .mockResolvedValueOnce(goalRec({ parentGoalId: 'p1' }))
        .mockResolvedValueOnce(goalRec({ id: 'p1', employeeId: 'emp-9', employee: { id: 'emp-9', firstName: 'X', lastName: 'Y', managerId: 'other' } }));
      prisma.goal.findMany.mockResolvedValue([]);
      const result: any = await service.getGoal(owner, 'g1');
      expect(result.parent).toBeNull();
    });
  });

  describe('tree', () => {
    it('builds the forest by parentGoalId and orders children under their parents', async () => {
      prisma.goal.findMany.mockResolvedValue([
        companyGoal(),
        deptGoal({ parentGoalId: 'co1' }),
        goalRec({ id: 'e1', parentGoalId: 'd1' }),
      ]);
      const roots: any[] = await service.tree(owner);
      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe('co1');
      expect(roots[0].children[0].id).toBe('d1');
      expect(roots[0].children[0].children[0].id).toBe('e1');
    });

    it('turns a node whose parent is not visible into a root', async () => {
      prisma.goal.findMany.mockResolvedValue([goalRec({ id: 'e1', parentGoalId: 'hidden' })]);
      const roots: any[] = await service.tree(owner);
      expect(roots.map((r) => r.id)).toEqual(['e1']);
    });

    it('returns just the requested subtree, and 404s when it is not visible', async () => {
      prisma.goal.findMany.mockResolvedValue([companyGoal(), deptGoal({ parentGoalId: 'co1' })]);
      const sub: any[] = await service.tree(owner, 'd1');
      expect(sub).toHaveLength(1);
      expect(sub[0].id).toBe('d1');
      await expect(service.tree(owner, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('admins load all employee goals; others only their own and their reports\'', async () => {
      prisma.goal.findMany.mockResolvedValue([]);
      await service.tree(admin);
      expect(prisma.goal.findMany.mock.calls[0][0].where.OR).toEqual([
        { ownerType: { in: ['COMPANY', 'DEPARTMENT'] } },
        { ownerType: 'EMPLOYEE' },
      ]);
      await service.tree(manager);
      expect(prisma.goal.findMany.mock.calls[1][0].where.OR).toEqual([
        { ownerType: { in: ['COMPANY', 'DEPARTMENT'] } },
        { ownerType: 'EMPLOYEE', employeeId: 'emp-mgr' },
        { ownerType: 'EMPLOYEE', employee: { managerId: 'emp-mgr' } },
      ]);
    });

    // Review Focus 5
    it('a non-admin without an employee record sees only company and department goals', async () => {
      prisma.goal.findMany.mockResolvedValue([]);
      await service.tree(managerNoEmployee);
      const or = prisma.goal.findMany.mock.calls[0][0].where.OR;
      expect(or).toEqual([{ ownerType: { in: ['COMPANY', 'DEPARTMENT'] } }]);
      expect(JSON.stringify(or)).not.toContain('undefined');
    });
  });

  // ============================================
  // Create
  // ============================================

  describe('createGoal', () => {
    const base = { title: 'Learn TS', targetDate: '2026-06-30' };

    beforeEach(() => {
      prisma.goal.create.mockResolvedValue({ id: 'new1', parentGoalId: null });
      prisma.goal.findFirst.mockResolvedValue(goalRec({ id: 'new1' }));
    });

    it('defaults to an EMPLOYEE goal owned by the caller, stamping createdByUserId', async () => {
      const result = await service.createGoal(owner, { ...base, description: 'Master it', weight: 1.5 });
      expect(prisma.goal.create).toHaveBeenCalledWith({
        data: {
          tenantId: 't1',
          ownerType: 'EMPLOYEE',
          employeeId: 'emp-1',
          departmentId: null,
          reviewId: null,
          parentGoalId: null,
          shareOnFeed: false,
          createdByUserId: 'u-emp-1',
          title: 'Learn TS',
          description: 'Master it',
          targetDate: new Date('2026-06-30'),
          weight: 1.5,
        },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.id).toBe('new1');
    });

    it('400s an employee goal without an employee profile', async () => {
      await expect(service.createGoal(adminNoEmployee, base)).rejects.toThrow(BadRequestException);
      expect(prisma.goal.create).not.toHaveBeenCalled();
    });

    it('lets an admin create a COMPANY goal with no owner', async () => {
      await service.createGoal(adminNoEmployee, { ...base, ownerType: 'COMPANY' as any });
      expect(prisma.goal.create.mock.calls[0][0].data).toMatchObject({
        ownerType: 'COMPANY',
        employeeId: null,
        departmentId: null,
        createdByUserId: 'u-HR_ADMIN',
      });
    });

    it('403s company and department goals from non-admins', async () => {
      await expect(service.createGoal(manager, { ...base, ownerType: 'COMPANY' as any })).rejects.toThrow(ForbiddenException);
      await expect(
        service.createGoal(owner, { ...base, ownerType: 'DEPARTMENT' as any, departmentId: 'dep1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('DEPARTMENT: needs a department (400) that exists in the tenant (404)', async () => {
      await expect(service.createGoal(admin, { ...base, ownerType: 'DEPARTMENT' as any })).rejects.toThrow(BadRequestException);
      prisma.department.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.createGoal(admin, { ...base, ownerType: 'DEPARTMENT' as any, departmentId: 'dep9' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.department.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'dep9', tenantId: 't1' } }),
      );
      prisma.department.findFirst.mockResolvedValueOnce({ id: 'dep1' });
      await service.createGoal(admin, { ...base, ownerType: 'DEPARTMENT' as any, departmentId: 'dep1' });
      expect(prisma.goal.create.mock.calls[0][0].data).toMatchObject({ ownerType: 'DEPARTMENT', departmentId: 'dep1' });
    });

    it('refuses a departmentId on COMPANY and EMPLOYEE goals (400)', async () => {
      await expect(
        service.createGoal(admin, { ...base, ownerType: 'COMPANY' as any, departmentId: 'dep1' }),
      ).rejects.toThrow(BadRequestException);
      await expect(service.createGoal(owner, { ...base, departmentId: 'dep1' })).rejects.toThrow(BadRequestException);
    });

    it('refuses a reviewId on a company goal', async () => {
      await expect(
        service.createGoal(admin, { ...base, ownerType: 'COMPANY' as any, reviewId: 'r1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('links an open review the caller owns', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue({ id: 'rev-1', status: 'SELF_REVIEW', employeeId: 'emp-1' });
      await service.createGoal(owner, { ...base, reviewId: 'rev-1' });
      expect(prisma.performanceReview.findFirst).toHaveBeenCalledWith({
        where: { id: 'rev-1', tenantId: 't1', employeeId: 'emp-1' },
        include: { cycle: { select: { status: true } } },
      });
      expect(prisma.goal.create.mock.calls[0][0].data.reviewId).toBe('rev-1');
    });

    it('400s when the review is missing or not the caller\'s', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);
      await expect(service.createGoal(owner, { ...base, reviewId: 'missing' })).rejects.toThrow(BadRequestException);
    });

    // Review Focus 4
    it('400s when the review is COMPLETED', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue({ id: 'rev-1', status: 'COMPLETED', employeeId: 'emp-1' });
      await expect(service.createGoal(owner, { ...base, reviewId: 'rev-1' })).rejects.toThrow(BadRequestException);
      expect(prisma.goal.create).not.toHaveBeenCalled();
    });

    it("400s when the review's cycle is COMPLETED even if the review is not", async () => {
      prisma.performanceReview.findFirst.mockResolvedValue({
        id: 'rev-1', status: 'MANAGER_REVIEW', employeeId: 'emp-1', cycle: { status: 'COMPLETED' },
      });
      await expect(service.createGoal(owner, { ...base, reviewId: 'rev-1' })).rejects.toThrow(BadRequestException);
      expect(prisma.goal.create).not.toHaveBeenCalled();
      expect(prisma.performanceReview.findFirst.mock.calls[0][0].include).toEqual({
        cycle: { select: { status: true } },
      });
    });

    it('validates the parent, creates, then recomputes the parent chain in the same tx', async () => {
      prisma.goal.findFirst.mockReset();
      prisma.goal.findFirst
        .mockResolvedValueOnce(companyGoal()) // validateParent
        .mockResolvedValueOnce(goalRec({ id: 'new1' })); // reload
      prisma.employee.findFirst.mockResolvedValue({ managerId: 'emp-mgr' });
      prisma.goal.create.mockResolvedValue({ id: 'new1', parentGoalId: 'co1' });

      await service.createGoal(owner, { ...base, parentGoalId: 'co1' });

      expect(prisma.goal.create.mock.calls[0][0].data.parentGoalId).toBe('co1');
      expect(progress.recomputeChain).toHaveBeenCalledWith('t1', 'co1', prisma);
    });

    it('does not create when the parent is refused', async () => {
      prisma.goal.findFirst.mockReset();
      prisma.goal.findFirst.mockResolvedValueOnce(null);
      await expect(service.createGoal(owner, { ...base, parentGoalId: 'nope' })).rejects.toThrow(NotFoundException);
      expect(prisma.goal.create).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Alignment
  // ============================================

  describe('validateParent', () => {
    const tx = () => prisma;
    const check = (
      goal: { id?: string; ownerType: any; employeeId: string | null },
      caller: AuthenticatedUser = owner,
    ) => service.validateParent('t1', goal, 'p1', caller, tx());

    beforeEach(() => {
      prisma.employee.findFirst.mockResolvedValue({ managerId: 'emp-mgr' });
    });

    it('404s a missing or cross-tenant parent (queried by tenant)', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(null);
      await expect(check({ ownerType: 'EMPLOYEE', employeeId: 'emp-1' })).rejects.toThrow(NotFoundException);
      expect(prisma.goal.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', tenantId: 't1' });
    });

    it('404s a parent the caller cannot read', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(
        goalRec({ id: 'p1', employeeId: 'emp-9', employee: { id: 'emp-9', firstName: 'X', lastName: 'Y', managerId: 'other' } }),
      );
      await expect(check({ ownerType: 'EMPLOYEE', employeeId: 'emp-1' })).rejects.toThrow(NotFoundException);
    });

    describe.each([
      ['COMPANY', 'COMPANY', true],
      ['COMPANY', 'DEPARTMENT', false],
      ['COMPANY', 'EMPLOYEE', false],
      ['DEPARTMENT', 'COMPANY', true],
      ['DEPARTMENT', 'DEPARTMENT', true],
      ['DEPARTMENT', 'EMPLOYEE', false],
      ['EMPLOYEE', 'COMPANY', true],
      ['EMPLOYEE', 'DEPARTMENT', true],
    ])('%s goal -> %s parent', (childType, parentType, ok) => {
      it(ok ? 'is allowed' : 'is refused with 400', async () => {
        const parent =
          parentType === 'COMPANY' ? companyGoal({ id: 'p1' }) : parentType === 'DEPARTMENT' ? deptGoal({ id: 'p1' }) : goalRec({ id: 'p1', employeeId: 'emp-admin' });
        prisma.goal.findFirst.mockResolvedValueOnce(parent);
        // the admin can read anything, so only the pairing rule is under test
        const promise = check(
          { ownerType: childType, employeeId: childType === 'EMPLOYEE' ? 'emp-1' : null },
          admin,
        );
        if (ok) await expect(promise).resolves.toBeUndefined();
        else await expect(promise).rejects.toThrow('This goal cannot be aligned to that parent');
      });
    });

    it('EMPLOYEE -> a goal owned by the owner\'s manager is allowed', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(
        goalRec({ id: 'p1', employeeId: 'emp-mgr', employee: { id: 'emp-mgr', firstName: 'M', lastName: 'G', managerId: 'emp-boss' } }),
      );
      await expect(check({ ownerType: 'EMPLOYEE', employeeId: 'emp-1' })).resolves.toBeUndefined();
    });

    it('EMPLOYEE -> a peer\'s goal is refused', async () => {
      // the admin can read it, so this is the pairing rule, not visibility
      prisma.goal.findFirst.mockResolvedValueOnce(
        goalRec({ id: 'p1', employeeId: 'emp-9', employee: { id: 'emp-9', firstName: 'X', lastName: 'Y', managerId: 'other' } }),
      );
      await expect(check({ ownerType: 'EMPLOYEE', employeeId: 'emp-1' }, admin)).rejects.toThrow(
        'This goal cannot be aligned to that parent',
      );
    });

    it('refuses a goal as its own parent', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(companyGoal({ id: 'co1' }));
      await expect(check({ id: 'co1', ownerType: 'COMPANY', employeeId: null })).rejects.toThrow('Alignment would create a cycle');
    });

    it('refuses a cycle of three (c -> b -> a, aligning a under c)', async () => {
      prisma.goal.findFirst
        .mockResolvedValueOnce(companyGoal({ id: 'c', parentGoalId: 'b' })) // the proposed parent
        .mockResolvedValueOnce({ id: 'b', parentGoalId: 'a' })
        .mockResolvedValueOnce({ id: 'a', parentGoalId: null });
      await expect(check({ id: 'a', ownerType: 'COMPANY', employeeId: null })).rejects.toThrow('Alignment would create a cycle');
    });

    it('accepts a deep but acyclic chain', async () => {
      prisma.goal.findFirst
        .mockResolvedValueOnce(companyGoal({ id: 'c', parentGoalId: 'b' }))
        .mockResolvedValueOnce({ id: 'b', parentGoalId: 'z' })
        .mockResolvedValueOnce({ id: 'z', parentGoalId: null });
      await expect(check({ id: 'a', ownerType: 'COMPANY', employeeId: null })).resolves.toBeUndefined();
    });

    it('refuses a chain deeper than 20', async () => {
      prisma.goal.findFirst
        .mockResolvedValueOnce(companyGoal({ id: 'p1', parentGoalId: 'n0' }))
        .mockImplementation(async (args: any) => ({ id: args.where.id, parentGoalId: `${args.where.id}x` }));
      await expect(check({ id: 'a', ownerType: 'COMPANY', employeeId: null })).rejects.toThrow('Alignment chain is too deep');
    });
  });

  // ============================================
  // Update
  // ============================================

  describe('updateGoal', () => {
    beforeEach(() => {
      prisma.goal.update.mockImplementation(async ({ data }: any) => goalRec(data));
    });

    // Review Focus 4
    it('refuses to edit a goal once its review is COMPLETED', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(
        goalRec({ review: { id: 'r', status: 'COMPLETED', cycle: { id: 'c', name: 'C' } } }),
      );
      await expect(service.updateGoal(owner, 'g1', { progress: 100 })).rejects.toThrow(
        'This review is completed; its goals can no longer be changed',
      );
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });

    it('refuses to edit a goal once its review cycle is COMPLETED (review not yet)', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(
        goalRec({ review: { id: 'r', status: 'MANAGER_REVIEW', cycle: { id: 'c', name: 'C', status: 'COMPLETED' } } }),
      );
      await expect(service.updateGoal(owner, 'g1', { progress: 100 })).rejects.toThrow(
        'This review is completed; its goals can no longer be changed',
      );
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });

    it('updates a manual goal and recomputes its chain in the same tx', async () => {
      prisma.goal.findFirst
        .mockResolvedValueOnce(goalRec({ review: { id: 'r', status: 'SELF_REVIEW', cycle: { id: 'c', name: 'C' } } }))
        .mockResolvedValueOnce(goalRec({ title: 'Updated', progress: 50 })); // reload
      const result = await service.updateGoal(owner, 'g1', { title: 'Updated', progress: 50 });
      expect(prisma.goal.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'g1' }, data: { title: 'Updated', progress: 50 } }),
      );
      expect(progress.recomputeChain).toHaveBeenCalledWith('t1', 'g1', prisma);
      expect(result.title).toBe('Updated');
    });

    it('404s a goal the caller cannot read, 403s one they can read but not write', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(null);
      await expect(service.updateGoal(owner, 'missing', { title: 'X' })).rejects.toThrow(NotFoundException);
      prisma.goal.findFirst.mockResolvedValueOnce(goalRec());
      await expect(service.updateGoal(stranger, 'g1', { title: 'X' })).rejects.toThrow(NotFoundException);
      prisma.goal.findFirst.mockResolvedValueOnce(goalRec());
      await expect(service.updateGoal(manager, 'g1', { title: 'X' })).rejects.toThrow(ForbiddenException);
    });

    it('403s an admin editing an employee goal', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(goalRec());
      await expect(service.updateGoal(admin, 'g1', { title: 'X' })).rejects.toThrow(ForbiddenException);
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });

    it('lets an admin edit a company goal, and refuses a plain employee', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(companyGoal()).mockResolvedValueOnce(companyGoal({ title: 'N' }));
      await service.updateGoal(admin, 'co1', { title: 'N' });
      expect(prisma.goal.update).toHaveBeenCalled();
      prisma.goal.findFirst.mockResolvedValueOnce(companyGoal());
      await expect(service.updateGoal(owner, 'co1', { title: 'N' })).rejects.toThrow(ForbiddenException);
    });

    it('rejects manual progress or status on a goal with key results', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ keyResults: [kr()] }));
      const msg = 'Progress of this goal is calculated from its key results or aligned goals';
      await expect(service.updateGoal(owner, 'g1', { progress: 10 })).rejects.toThrow(msg);
      await expect(service.updateGoal(owner, 'g1', { status: 'COMPLETED' })).rejects.toThrow(msg);
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });

    it('rejects manual progress or status on a goal with aligned children', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ _count: { children: 1 }, children: [{ ownerType: 'EMPLOYEE' }] }));
      await expect(service.updateGoal(owner, 'g1', { progress: 10 })).rejects.toThrow(BadRequestException);
    });

    it('a company goal with only employee children is manual: admin can set progress and status', async () => {
      prisma.goal.findFirst.mockResolvedValue(
        companyGoal({ _count: { children: 1 }, children: [{ ownerType: 'EMPLOYEE' }] }),
      );
      await service.updateGoal(admin, 'co1', { progress: 40 });
      expect(prisma.goal.update.mock.calls[0][0].data).toEqual({ progress: 40 });
    });

    it('a company goal with a department child still derives and rejects manual progress', async () => {
      prisma.goal.findFirst.mockResolvedValue(
        companyGoal({ _count: { children: 2 }, children: [{ ownerType: 'EMPLOYEE' }, { ownerType: 'DEPARTMENT' }] }),
      );
      await expect(service.updateGoal(admin, 'co1', { progress: 40 })).rejects.toThrow(BadRequestException);
    });

    describe('detaching a child (parentGoalId: null)', () => {
      const parentRec = (over: Record<string, unknown> = {}) => companyGoal({ id: 'co1', ...over });

      it('admin detaches an employee child from a company goal, then recomputes both chains', async () => {
        prisma.goal.findFirst
          .mockResolvedValueOnce(goalRec({ parentGoalId: 'co1' })) // the child
          .mockResolvedValueOnce(parentRec()) // its parent
          .mockResolvedValue(goalRec({ parentGoalId: null })); // reload
        await service.updateGoal(admin, 'g1', { parentGoalId: null });
        expect(prisma.goal.update.mock.calls[0][0].data).toEqual({ parentGoalId: null });
        expect(progress.recomputeChain.mock.calls.map((c: any[]) => c[1])).toEqual(['g1', 'co1']);
      });

      it("a manager detaches a report's goal from their own goal", async () => {
        const mgrGoal = goalRec({ id: 'mg1', employeeId: 'emp-mgr', employee: { id: 'emp-mgr', firstName: 'M', lastName: 'G', managerId: null } });
        prisma.goal.findFirst
          .mockResolvedValueOnce(goalRec({ parentGoalId: 'mg1' }))
          .mockResolvedValueOnce(mgrGoal)
          .mockResolvedValue(goalRec({ parentGoalId: null }));
        await service.updateGoal(manager, 'g1', { parentGoalId: null });
        expect(prisma.goal.update.mock.calls[0][0].data).toEqual({ parentGoalId: null });
        expect(progress.recomputeChain.mock.calls.map((c: any[]) => c[1])).toEqual(['g1', 'mg1']);
      });

      it('a third party who cannot write the parent gets 403', async () => {
        // emp-mgr can read the child (their report) but does not own the employee-owned parent
        const other = goalRec({ id: 'p9', employeeId: 'emp-5', employee: { id: 'emp-5', firstName: 'X', lastName: 'Y', managerId: 'emp-mgr' } });
        prisma.goal.findFirst
          .mockResolvedValueOnce(goalRec({ parentGoalId: 'p9' }))
          .mockResolvedValueOnce(other);
        await expect(service.updateGoal(manager, 'g1', { parentGoalId: null })).rejects.toThrow(ForbiddenException);
        expect(prisma.goal.update).not.toHaveBeenCalled();
      });

      it('an admin cannot detach from an EMPLOYEE parent they do not own', async () => {
        prisma.goal.findFirst
          .mockResolvedValueOnce(goalRec({ parentGoalId: 'p9' }))
          .mockResolvedValueOnce(goalRec({ id: 'p9', employeeId: 'emp-5' }));
        await expect(service.updateGoal(admin, 'g1', { parentGoalId: null })).rejects.toThrow(ForbiddenException);
      });

      it('the detach body may carry nothing else: extra fields get 403', async () => {
        prisma.goal.findFirst
          .mockResolvedValueOnce(goalRec({ parentGoalId: 'co1' }))
          .mockResolvedValueOnce(parentRec());
        await expect(
          service.updateGoal(admin, 'g1', { parentGoalId: null, title: 'Sneaky' }),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.goal.update).not.toHaveBeenCalled();
      });

      it('a goal with no parent cannot be detached by a non-writer (403)', async () => {
        prisma.goal.findFirst.mockResolvedValueOnce(goalRec({ parentGoalId: null }));
        await expect(service.updateGoal(admin, 'g1', { parentGoalId: null })).rejects.toThrow(ForbiddenException);
      });

      it('still honours the review lock', async () => {
        prisma.goal.findFirst
          .mockResolvedValueOnce(
            goalRec({ parentGoalId: 'co1', review: { id: 'r', status: 'COMPLETED', cycle: { id: 'c', name: 'C' } } }),
          )
          .mockResolvedValueOnce(parentRec());
        await expect(service.updateGoal(admin, 'g1', { parentGoalId: null })).rejects.toThrow(BadRequestException);
        expect(prisma.goal.update).not.toHaveBeenCalled();
      });
    });

    it('still lets a derived goal change its title and weight', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ keyResults: [kr()] }));
      await service.updateGoal(owner, 'g1', { title: 'New', weight: 2 });
      expect(prisma.goal.update.mock.calls[0][0].data).toEqual({ title: 'New', weight: 2 });
    });

    it('manual COMPLETED sets progress 100, stamps completedAt and posts the feed item', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ status: 'IN_PROGRESS', progress: 40 }));
      await service.updateGoal(owner, 'g1', { status: 'COMPLETED' });
      const data = prisma.goal.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: 'COMPLETED', progress: 100 });
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(progress.postCompletion).toHaveBeenCalledTimes(1);
      expect(progress.postCompletion.mock.calls[0][1]).toBe(prisma);
    });

    it('does not post again when the goal was already COMPLETED, and keeps completedAt', async () => {
      const done = new Date('2026-03-15T12:00:00Z');
      prisma.goal.findFirst.mockResolvedValue(goalRec({ status: 'COMPLETED', progress: 100, completedAt: done }));
      await service.updateGoal(owner, 'g1', { status: 'COMPLETED' });
      expect(prisma.goal.update.mock.calls[0][0].data.completedAt).toBe(done);
      expect(progress.postCompletion).not.toHaveBeenCalled();
    });

    it('leaving COMPLETED clears completedAt', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ status: 'COMPLETED', progress: 100, completedAt: new Date() }));
      await service.updateGoal(owner, 'g1', { status: 'IN_PROGRESS' });
      expect(prisma.goal.update.mock.calls[0][0].data).toMatchObject({ status: 'IN_PROGRESS', completedAt: null });
      expect(progress.postCompletion).not.toHaveBeenCalled();
    });

    // Review Focus 1
    it('re-aligning A -> B validates B, then recomputes the goal chain (new parent) and the old parent chain', async () => {
      prisma.goal.findFirst
        .mockResolvedValueOnce(goalRec({ parentGoalId: 'pA' })) // loadWritable
        .mockResolvedValueOnce(companyGoal({ id: 'pB' })) // validateParent: the new parent
        .mockResolvedValue(goalRec({ parentGoalId: 'pB' })); // reload
      prisma.employee.findFirst.mockResolvedValue({ managerId: 'emp-mgr' });

      await service.updateGoal(owner, 'g1', { parentGoalId: 'pB' });

      expect(prisma.goal.update.mock.calls[0][0].data).toEqual({ parentGoalId: 'pB' });
      expect(progress.recomputeChain.mock.calls.map((c: any[]) => c[1])).toEqual(['g1', 'pA']);
      expect(progress.recomputeChain.mock.calls.every((c: any[]) => c[2] === prisma)).toBe(true);
    });

    it('removing the alignment (null) skips validation but still recomputes the old parent', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ parentGoalId: 'pA' }));
      await service.updateGoal(owner, 'g1', { parentGoalId: null });
      expect(prisma.goal.update.mock.calls[0][0].data).toEqual({ parentGoalId: null });
      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
      expect(progress.recomputeChain.mock.calls.map((c: any[]) => c[1])).toEqual(['g1', 'pA']);
    });

    it('an unchanged parent is not re-validated or recomputed twice', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ parentGoalId: 'pA' }));
      await service.updateGoal(owner, 'g1', { parentGoalId: 'pA' });
      expect(prisma.goal.update.mock.calls[0][0].data).toEqual({});
      expect(progress.recomputeChain.mock.calls.map((c: any[]) => c[1])).toEqual(['g1']);
    });

    it('a refused re-alignment writes nothing', async () => {
      prisma.goal.findFirst
        .mockResolvedValueOnce(goalRec())
        .mockResolvedValueOnce(null);
      await expect(service.updateGoal(owner, 'g1', { parentGoalId: 'nope' })).rejects.toThrow(NotFoundException);
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Delete
  // ============================================

  describe('deleteGoal', () => {
    it('deletes a goal and recomputes its old parent', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ parentGoalId: 'pA' }));
      prisma.goal.delete.mockResolvedValue({});
      const result = await service.deleteGoal(owner, 'g1');
      expect(prisma.goal.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
      expect(progress.recomputeChain).toHaveBeenCalledWith('t1', 'pA', prisma);
      expect(result).toEqual({ message: 'Goal deleted' });
    });

    it('refuses to delete a goal that still has children', async () => {
      prisma.goal.findFirst.mockResolvedValue(goalRec({ _count: { children: 2 } }));
      await expect(service.deleteGoal(owner, 'g1')).rejects.toThrow('Re-align or delete the child goals first');
      expect(prisma.goal.delete).not.toHaveBeenCalled();
    });

    it('404s a missing goal; 403s an admin deleting an employee goal', async () => {
      prisma.goal.findFirst.mockResolvedValueOnce(null);
      await expect(service.deleteGoal(owner, 'missing')).rejects.toThrow(NotFoundException);
      prisma.goal.findFirst.mockResolvedValueOnce(goalRec());
      await expect(service.deleteGoal(admin, 'g1')).rejects.toThrow(ForbiddenException);
    });

    // Review Focus 4
    it('400s when the review is COMPLETED', async () => {
      prisma.goal.findFirst.mockResolvedValue(
        goalRec({ review: { id: 'r', status: 'COMPLETED', cycle: { id: 'c', name: 'C' } } }),
      );
      await expect(service.deleteGoal(owner, 'g1')).rejects.toThrow(BadRequestException);
      expect(prisma.goal.delete).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Key results
  // ============================================

  describe('key results', () => {
    beforeEach(() => {
      prisma.goal.findFirst.mockResolvedValue(goalRec());
      prisma.keyResult.create.mockImplementation(async ({ data }: any) => kr(data));
      prisma.keyResult.update.mockImplementation(async ({ data }: any) => kr(data));
    });

    it('creates a key result with computed progress, then recomputes the chain in the tx', async () => {
      const result = await service.addKeyResult(owner, 'g1', { title: 'Close 50', targetValue: 50, currentValue: 25 });
      expect(prisma.keyResult.create.mock.calls[0][0].data).toMatchObject({
        tenantId: 't1',
        goalId: 'g1',
        metricType: 'NUMBER',
        startValue: 0,
        targetValue: 50,
        currentValue: 25,
        progress: 50,
      });
      expect(progress.recomputeChain).toHaveBeenCalledWith('t1', 'g1', prisma);
      expect(typeof result.targetValue).toBe('number');
    });

    it('forces BOOLEAN key results to 0 -> 1', async () => {
      await service.addKeyResult(owner, 'g1', { title: 'Launch', metricType: 'BOOLEAN' as any, targetValue: 99, startValue: 7, currentValue: 1 });
      expect(prisma.keyResult.create.mock.calls[0][0].data).toMatchObject({
        startValue: 0,
        targetValue: 1,
        progress: 100,
      });
    });

    it('400s a key result whose target equals its start, writing nothing', async () => {
      await expect(service.addKeyResult(owner, 'g1', { title: 'X', startValue: 5, targetValue: 5 })).rejects.toThrow(BadRequestException);
      expect(prisma.keyResult.create).not.toHaveBeenCalled();
    });

    it('403s an admin adding a key result to an employee goal; 404s a stranger', async () => {
      await expect(service.addKeyResult(admin, 'g1', { title: 'X', targetValue: 5 })).rejects.toThrow(ForbiddenException);
      await expect(service.addKeyResult(stranger, 'g1', { title: 'X', targetValue: 5 })).rejects.toThrow(NotFoundException);
    });

    it('lets an admin add key results to a company goal', async () => {
      prisma.goal.findFirst.mockResolvedValue(companyGoal());
      await service.addKeyResult(admin, 'co1', { title: 'X', targetValue: 5 });
      expect(prisma.keyResult.create).toHaveBeenCalled();
    });

    // Review Focus 4
    it('400s key result changes once the review is COMPLETED', async () => {
      prisma.goal.findFirst.mockResolvedValue(
        goalRec({ review: { id: 'r', status: 'COMPLETED', cycle: { id: 'c', name: 'C' } } }),
      );
      await expect(service.addKeyResult(owner, 'g1', { title: 'X', targetValue: 5 })).rejects.toThrow(BadRequestException);
      await expect(service.updateKeyResult(owner, 'g1', 'kr1', { currentValue: 5 })).rejects.toThrow(BadRequestException);
      await expect(service.removeKeyResult(owner, 'g1', 'kr1')).rejects.toThrow(BadRequestException);
      expect(prisma.keyResult.create).not.toHaveBeenCalled();
      expect(prisma.keyResult.update).not.toHaveBeenCalled();
      expect(prisma.keyResult.delete).not.toHaveBeenCalled();
    });

    it('update merges onto the stored Decimals and recomputes progress', async () => {
      prisma.keyResult.findFirst.mockResolvedValue(kr({ startValue: dec(100), targetValue: dec(20), currentValue: dec(100) }));
      await service.updateKeyResult(owner, 'g1', 'kr1', { currentValue: 60 });
      expect(prisma.keyResult.findFirst).toHaveBeenCalledWith({ where: { id: 'kr1', goalId: 'g1', tenantId: 't1' } });
      expect(prisma.keyResult.update.mock.calls[0][0].data).toMatchObject({
        startValue: 100,
        targetValue: 20,
        currentValue: 60,
        progress: 50,
      });
      expect(progress.recomputeChain).toHaveBeenCalledWith('t1', 'g1', prisma);
    });

    it('update only touches fields that were sent', async () => {
      prisma.keyResult.findFirst.mockResolvedValue(kr());
      await service.updateKeyResult(owner, 'g1', 'kr1', { title: 'Renamed' });
      const data = prisma.keyResult.update.mock.calls[0][0].data;
      expect(data.title).toBe('Renamed');
      expect(data).not.toHaveProperty('unit');
      expect(data).not.toHaveProperty('weight');
    });

    it('404s a key result that is not on this goal', async () => {
      prisma.keyResult.findFirst.mockResolvedValue(null);
      await expect(service.updateKeyResult(owner, 'g1', 'nope', { currentValue: 1 })).rejects.toThrow(NotFoundException);
      await expect(service.removeKeyResult(owner, 'g1', 'nope')).rejects.toThrow(NotFoundException);
    });

    it('delete removes the key result and recomputes', async () => {
      prisma.keyResult.findFirst.mockResolvedValue(kr());
      prisma.keyResult.delete.mockResolvedValue({});
      await service.removeKeyResult(owner, 'g1', 'kr1');
      expect(prisma.keyResult.delete).toHaveBeenCalledWith({ where: { id: 'kr1' } });
      expect(progress.recomputeChain).toHaveBeenCalledWith('t1', 'g1', prisma);
    });
  });
});
