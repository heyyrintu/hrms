import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
  mockHrAdmin,
} from '../../test/helpers';
import {
  NotificationType,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

describe('HelpdeskService', () => {
  let service: HelpdeskService;
  let prisma: any;
  let notifications: any;

  const tenantId = 'tenant-1';
  const ownerEmployeeId = 'emp-owner';
  const agentUserId = 'user-agent';

  const ownerUser: AuthenticatedUser = {
    userId: 'user-owner',
    email: 'owner@test.com',
    tenantId,
    role: UserRole.EMPLOYEE,
    employeeId: ownerEmployeeId,
  };

  const agentUser: AuthenticatedUser = {
    userId: agentUserId,
    email: 'agent@test.com',
    tenantId,
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-agent',
  };

  const hrUser: AuthenticatedUser = {
    userId: 'user-hr',
    email: 'hr@test.com',
    tenantId,
    role: UserRole.HR_ADMIN,
    employeeId: mockHrAdmin.employeeId,
  };

  const strangerUser: AuthenticatedUser = {
    userId: 'user-stranger',
    email: 'stranger@test.com',
    tenantId,
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-stranger',
  };

  const ticketFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 'ticket-1',
    tenantId,
    ticketNumber: 7,
    employeeId: ownerEmployeeId,
    categoryId: 'cat-1',
    subject: 'Payslip missing',
    description: 'March payslip has not arrived',
    priority: TicketPriority.MEDIUM,
    status: TicketStatus.OPEN,
    assignedToId: null,
    slaDeadline: new Date('2026-03-17T12:00:00Z'),
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date('2026-03-15T12:00:00Z'),
    updatedAt: new Date('2026-03-15T12:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HelpdeskService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
      ],
    }).compile();

    service = module.get<HelpdeskService>(HelpdeskService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // Categories
  // ============================================

  describe('categories', () => {
    it('lists active categories for the tenant only', async () => {
      prisma.hrTicketCategory.findMany.mockResolvedValue([{ id: 'cat-1' }]);

      await service.listCategories(tenantId);

      expect(prisma.hrTicketCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, isActive: true } }),
      );
    });

    it('includes inactive categories when asked', async () => {
      prisma.hrTicketCategory.findMany.mockResolvedValue([]);

      await service.listCategories(tenantId, true);

      expect(prisma.hrTicketCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
    });

    it('creates a category with the default SLA when none is given', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue(null);
      prisma.hrTicketCategory.create.mockResolvedValue({ id: 'cat-1' });

      await service.createCategory(tenantId, { name: 'Payroll', code: 'PAY' });

      expect(prisma.hrTicketCategory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          name: 'Payroll',
          code: 'PAY',
          slaHours: 48,
        }),
      });
    });

    it('rejects a duplicate code within the tenant', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-existing' });

      await expect(
        service.createCategory(tenantId, { name: 'Payroll', code: 'PAY' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.hrTicketCategory.create).not.toHaveBeenCalled();
    });

    it('404s when updating a category from another tenant', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCategory(tenantId, 'cat-other', { name: 'Nope' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates a category in place', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-1', code: 'PAY' });
      prisma.hrTicketCategory.update.mockResolvedValue({ id: 'cat-1', slaHours: 24 });

      await service.updateCategory(tenantId, 'cat-1', { slaHours: 24 });

      expect(prisma.hrTicketCategory.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { slaHours: 24 },
      });
    });
  });

  // ============================================
  // createTicket
  // ============================================

  describe('createTicket', () => {
    const dto = {
      categoryId: 'cat-1',
      subject: 'Payslip missing',
      description: 'March payslip has not arrived',
    };

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('numbers the ticket one above the tenant maximum, inside a transaction', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-1', slaHours: 48 });
      prisma.hrTicket.aggregate.mockResolvedValue({ _max: { ticketNumber: 41 } });
      prisma.hrTicket.create.mockResolvedValue(ticketFixture({ ticketNumber: 42 }));

      await service.createTicket(tenantId, ownerEmployeeId, dto);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.hrTicket.aggregate).toHaveBeenCalledWith({
        where: { tenantId },
        _max: { ticketNumber: true },
      });
      expect(prisma.hrTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ticketNumber: 42 }),
        }),
      );
    });

    it('starts at ticket number 1 for a tenant with no tickets', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-1', slaHours: 48 });
      prisma.hrTicket.aggregate.mockResolvedValue({ _max: { ticketNumber: null } });
      prisma.hrTicket.create.mockResolvedValue(ticketFixture({ ticketNumber: 1 }));

      await service.createTicket(tenantId, ownerEmployeeId, dto);

      expect(prisma.hrTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ticketNumber: 1 }) }),
      );
    });

    it('sets slaDeadline to createdAt plus the category SLA hours', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-1', slaHours: 4 });
      prisma.hrTicket.aggregate.mockResolvedValue({ _max: { ticketNumber: 0 } });
      prisma.hrTicket.create.mockResolvedValue(ticketFixture());

      await service.createTicket(tenantId, ownerEmployeeId, dto);

      const data = prisma.hrTicket.create.mock.calls[0][0].data;
      expect(data.slaDeadline).toEqual(new Date('2026-03-15T16:00:00Z'));
    });

    it('defaults the priority to MEDIUM', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-1', slaHours: 48 });
      prisma.hrTicket.aggregate.mockResolvedValue({ _max: { ticketNumber: 0 } });
      prisma.hrTicket.create.mockResolvedValue(ticketFixture());

      await service.createTicket(tenantId, ownerEmployeeId, dto);

      expect(prisma.hrTicket.create.mock.calls[0][0].data.priority).toBe(
        TicketPriority.MEDIUM,
      );
    });

    it('404s when the category belongs to another tenant or is inactive', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue(null);

      await expect(service.createTicket(tenantId, ownerEmployeeId, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.hrTicket.create).not.toHaveBeenCalled();
    });

    it('retries once when two creates collide on the unique ticket number', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-1', slaHours: 48 });
      prisma.hrTicket.aggregate
        .mockResolvedValueOnce({ _max: { ticketNumber: 41 } })
        .mockResolvedValueOnce({ _max: { ticketNumber: 42 } });
      prisma.hrTicket.create
        .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
        .mockResolvedValueOnce(ticketFixture({ ticketNumber: 43 }));

      const result = await service.createTicket(tenantId, ownerEmployeeId, dto);

      expect(prisma.hrTicket.create).toHaveBeenCalledTimes(2);
      expect(result.ticketNumber).toBe(43);
    });

    it('gives up after the second unique violation', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-1', slaHours: 48 });
      prisma.hrTicket.aggregate.mockResolvedValue({ _max: { ticketNumber: 41 } });
      prisma.hrTicket.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );

      await expect(service.createTicket(tenantId, ownerEmployeeId, dto)).rejects.toThrow();
      expect(prisma.hrTicket.create).toHaveBeenCalledTimes(2);
    });

    it('notifies HR that a ticket was raised', async () => {
      prisma.hrTicketCategory.findFirst.mockResolvedValue({ id: 'cat-1', slaHours: 48 });
      prisma.hrTicket.aggregate.mockResolvedValue({ _max: { ticketNumber: 0 } });
      prisma.hrTicket.create.mockResolvedValue(ticketFixture({ ticketNumber: 1 }));

      await service.createTicket(tenantId, ownerEmployeeId, dto);

      expect(notifications.notifyByRole).toHaveBeenCalledWith(
        tenantId,
        [UserRole.HR_ADMIN],
        NotificationType.TICKET_CREATED,
        expect.any(String),
        expect.any(String),
        expect.stringContaining('/admin/helpdesk'),
      );
    });
  });

  // ============================================
  // Listing
  // ============================================

  describe('findMyTickets', () => {
    it('scopes to the caller employee', async () => {
      prisma.hrTicket.findMany.mockResolvedValue([]);
      prisma.hrTicket.count.mockResolvedValue(0);

      await service.findMyTickets(tenantId, ownerEmployeeId, {});

      expect(prisma.hrTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId, employeeId: ownerEmployeeId }),
        }),
      );
    });

    it('refuses to list when the caller has no employee record', async () => {
      await expect(
        service.findMyTickets(tenantId, undefined as unknown as string, {}),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.hrTicket.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      prisma.hrTicket.findMany.mockResolvedValue([]);
      prisma.hrTicket.count.mockResolvedValue(0);
      jest.useFakeTimers().setSystemTime(new Date('2026-03-20T12:00:00Z'));
    });

    afterEach(() => jest.useRealTimers());

    it('filters by status, assignee and category', async () => {
      await service.findAll(tenantId, {
        status: TicketStatus.IN_PROGRESS,
        assignedToId: agentUserId,
        categoryId: 'cat-1',
      });

      expect(prisma.hrTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            status: TicketStatus.IN_PROGRESS,
            assignedToId: agentUserId,
            categoryId: 'cat-1',
          }),
        }),
      );
    });

    it('overdue=true means past SLA and not yet resolved or closed', async () => {
      await service.findAll(tenantId, { overdue: true });

      const where = prisma.hrTicket.findMany.mock.calls[0][0].where;
      expect(where.slaDeadline).toEqual({ lt: new Date('2026-03-20T12:00:00Z') });
      expect(where.status).toEqual({
        notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
      });
    });

    it('does not constrain the deadline when overdue is not asked for', async () => {
      await service.findAll(tenantId, {});

      expect(prisma.hrTicket.findMany.mock.calls[0][0].where.slaDeadline).toBeUndefined();
    });

    it('returns paginated meta', async () => {
      prisma.hrTicket.count.mockResolvedValue(3);

      const result = await service.findAll(tenantId, { page: 1, limit: 20 });

      expect(result.meta).toEqual({ total: 3, page: 1, limit: 20, totalPages: 1 });
    });
  });

  // ============================================
  // findById + comment visibility
  // ============================================

  describe('findById', () => {
    const publicComment = {
      id: 'c-1',
      content: 'Looking into it',
      isInternal: false,
      authorId: agentUserId,
    };
    const internalComment = {
      id: 'c-2',
      content: 'Check the payroll run first',
      isInternal: true,
      authorId: agentUserId,
    };

    const withComments = (overrides: Record<string, unknown> = {}) =>
      ticketFixture({
        assignedToId: agentUserId,
        comments: [publicComment, internalComment],
        ...overrides,
      });

    it('hides internal comments from the employee who raised the ticket', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(withComments());

      const result = await service.findById(tenantId, 'ticket-1', ownerUser);

      expect(result.comments.map((c: any) => c.id)).toEqual(['c-1']);
    });

    it('shows internal comments to HR', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(withComments());

      const result = await service.findById(tenantId, 'ticket-1', hrUser);

      expect(result.comments.map((c: any) => c.id)).toEqual(['c-1', 'c-2']);
    });

    it('shows internal comments to the assignee', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(withComments());

      const result = await service.findById(tenantId, 'ticket-1', agentUser);

      expect(result.comments.map((c: any) => c.id)).toEqual(['c-1', 'c-2']);
    });

    it('refuses anyone who is neither owner, assignee nor HR', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(withComments());

      await expect(service.findById(tenantId, 'ticket-1', strangerUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s for a ticket in another tenant', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(null);

      await expect(service.findById(tenantId, 'ticket-x', hrUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('tells the caller which statuses they may move to', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(
        withComments({ status: TicketStatus.RESOLVED }),
      );

      const result = await service.findById(tenantId, 'ticket-1', ownerUser);

      expect([...result.allowedStatuses].sort()).toEqual(
        [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS].sort(),
      );
      expect(result.actor).toBe('OWNER');
    });
  });

  // ============================================
  // assign
  // ============================================

  describe('assign', () => {
    it('moves an OPEN ticket to IN_PROGRESS and notifies the assignee', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());
      prisma.user.findFirst.mockResolvedValue({ id: agentUserId, employeeId: 'emp-agent' });
      prisma.hrTicket.update.mockResolvedValue(
        ticketFixture({ assignedToId: agentUserId, status: TicketStatus.IN_PROGRESS }),
      );

      await service.assign(tenantId, 'ticket-1', { assignedToId: agentUserId });

      expect(prisma.hrTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ticket-1' },
          data: { assignedToId: agentUserId, status: TicketStatus.IN_PROGRESS },
        }),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        'emp-agent',
        NotificationType.TICKET_ASSIGNED,
        expect.any(String),
        expect.any(String),
        expect.stringContaining('/helpdesk/ticket-1'),
      );
    });

    it('leaves a non-OPEN status alone when reassigning', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(
        ticketFixture({ status: TicketStatus.WAITING_ON_EMPLOYEE }),
      );
      prisma.user.findFirst.mockResolvedValue({ id: agentUserId, employeeId: 'emp-agent' });
      prisma.hrTicket.update.mockResolvedValue(ticketFixture());

      await service.assign(tenantId, 'ticket-1', { assignedToId: agentUserId });

      expect(prisma.hrTicket.update.mock.calls[0][0].data).toEqual({
        assignedToId: agentUserId,
      });
    });

    it('skips the notification when the assignee has no employee record', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());
      prisma.user.findFirst.mockResolvedValue({ id: agentUserId, employeeId: null });
      prisma.hrTicket.update.mockResolvedValue(ticketFixture());

      await service.assign(tenantId, 'ticket-1', { assignedToId: agentUserId });

      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('404s when the assignee is not a user in this tenant', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.assign(tenantId, 'ticket-1', { assignedToId: 'user-elsewhere' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.hrTicket.update).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // changeStatus
  // ============================================

  describe('changeStatus', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-16T12:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('lets HR start an open ticket', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());
      prisma.hrTicket.update.mockResolvedValue(
        ticketFixture({ status: TicketStatus.IN_PROGRESS }),
      );

      await service.changeStatus(
        tenantId,
        'ticket-1',
        { status: TicketStatus.IN_PROGRESS },
        hrUser,
      );

      expect(prisma.hrTicket.update.mock.calls[0][0].data).toEqual({
        status: TicketStatus.IN_PROGRESS,
      });
    });

    it('stamps resolvedAt and notifies the owner on RESOLVED', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(
        ticketFixture({ status: TicketStatus.IN_PROGRESS, assignedToId: agentUserId }),
      );
      prisma.hrTicket.update.mockResolvedValue(
        ticketFixture({ status: TicketStatus.RESOLVED }),
      );

      await service.changeStatus(
        tenantId,
        'ticket-1',
        { status: TicketStatus.RESOLVED },
        agentUser,
      );

      expect(prisma.hrTicket.update.mock.calls[0][0].data).toEqual({
        status: TicketStatus.RESOLVED,
        resolvedAt: new Date('2026-03-16T12:00:00Z'),
      });
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        ownerEmployeeId,
        NotificationType.TICKET_RESOLVED,
        expect.any(String),
        expect.any(String),
        expect.stringContaining('/helpdesk/ticket-1'),
      );
    });

    it('stamps closedAt on CLOSED', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(
        ticketFixture({ status: TicketStatus.RESOLVED }),
      );
      prisma.hrTicket.update.mockResolvedValue(ticketFixture({ status: TicketStatus.CLOSED }));

      await service.changeStatus(
        tenantId,
        'ticket-1',
        { status: TicketStatus.CLOSED },
        ownerUser,
      );

      expect(prisma.hrTicket.update.mock.calls[0][0].data).toEqual({
        status: TicketStatus.CLOSED,
        closedAt: new Date('2026-03-16T12:00:00Z'),
      });
    });

    it('refuses a transition the owner is not allowed to make', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(
        ticketFixture({ status: TicketStatus.IN_PROGRESS }),
      );

      await expect(
        service.changeStatus(
          tenantId,
          'ticket-1',
          { status: TicketStatus.RESOLVED },
          ownerUser,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.hrTicket.update).not.toHaveBeenCalled();
    });

    it('refuses an illegal transition even for HR', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(
        ticketFixture({ status: TicketStatus.OPEN }),
      );

      await expect(
        service.changeStatus(tenantId, 'ticket-1', { status: TicketStatus.CLOSED }, hrUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a bystander outright', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());

      await expect(
        service.changeStatus(
          tenantId,
          'ticket-1',
          { status: TicketStatus.IN_PROGRESS },
          strangerUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================
  // addComment
  // ============================================

  describe('addComment', () => {
    it('records a public comment from the owner', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());
      prisma.hrTicketComment.create.mockResolvedValue({ id: 'c-1' });

      await service.addComment(tenantId, 'ticket-1', { content: 'Any update?' }, ownerUser);

      expect(prisma.hrTicketComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            ticketId: 'ticket-1',
            authorId: ownerUser.userId,
            content: 'Any update?',
            isInternal: false,
          }),
        }),
      );
    });

    it('refuses an internal note from the ticket owner', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());

      await expect(
        service.addComment(
          tenantId,
          'ticket-1',
          { content: 'secret', isInternal: true },
          ownerUser,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.hrTicketComment.create).not.toHaveBeenCalled();
    });

    it('allows an internal note from HR', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());
      prisma.hrTicketComment.create.mockResolvedValue({ id: 'c-2' });

      await service.addComment(
        tenantId,
        'ticket-1',
        { content: 'Escalate to payroll', isInternal: true },
        hrUser,
      );

      expect(prisma.hrTicketComment.create.mock.calls[0][0].data.isInternal).toBe(true);
    });

    it('allows an internal note from the assignee', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(
        ticketFixture({ assignedToId: agentUserId }),
      );
      prisma.hrTicketComment.create.mockResolvedValue({ id: 'c-3' });

      await service.addComment(
        tenantId,
        'ticket-1',
        { content: 'Payroll re-run queued', isInternal: true },
        agentUser,
      );

      expect(prisma.hrTicketComment.create.mock.calls[0][0].data.isInternal).toBe(true);
    });

    it('refuses a bystander', async () => {
      prisma.hrTicket.findFirst.mockResolvedValue(ticketFixture());

      await expect(
        service.addComment(tenantId, 'ticket-1', { content: 'hi' }, strangerUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================
  // stats
  // ============================================

  describe('getStats', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-31T12:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('returns a zero-filled count for every status', async () => {
      prisma.hrTicket.groupBy.mockResolvedValue([
        { status: TicketStatus.OPEN, _count: { _all: 2 } },
        { status: TicketStatus.CLOSED, _count: { _all: 5 } },
      ]);
      prisma.hrTicket.count.mockResolvedValue(0);
      prisma.hrTicket.findMany.mockResolvedValue([]);

      const stats = await service.getStats(tenantId);

      expect(stats.byStatus).toEqual({
        OPEN: 2,
        IN_PROGRESS: 0,
        WAITING_ON_EMPLOYEE: 0,
        RESOLVED: 0,
        CLOSED: 5,
      });
    });

    it('counts overdue as past SLA and still open', async () => {
      prisma.hrTicket.groupBy.mockResolvedValue([]);
      prisma.hrTicket.count.mockResolvedValue(3);
      prisma.hrTicket.findMany.mockResolvedValue([]);

      const stats = await service.getStats(tenantId);

      expect(stats.overdue).toBe(3);
      expect(prisma.hrTicket.count).toHaveBeenCalledWith({
        where: {
          tenantId,
          slaDeadline: { lt: new Date('2026-03-31T12:00:00Z') },
          status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        },
      });
    });

    it('averages resolution hours over the last 30 days', async () => {
      prisma.hrTicket.groupBy.mockResolvedValue([]);
      prisma.hrTicket.count.mockResolvedValue(0);
      prisma.hrTicket.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-03-20T12:00:00Z'),
          resolvedAt: new Date('2026-03-20T14:00:00Z'),
        },
        {
          createdAt: new Date('2026-03-21T12:00:00Z'),
          resolvedAt: new Date('2026-03-21T16:00:00Z'),
        },
      ]);

      const stats = await service.getStats(tenantId);

      expect(stats.avgResolutionHours).toBe(3);
      expect(prisma.hrTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            resolvedAt: { gte: new Date('2026-03-01T12:00:00Z') },
          }),
        }),
      );
    });

    it('reports null rather than zero when nothing was resolved', async () => {
      prisma.hrTicket.groupBy.mockResolvedValue([]);
      prisma.hrTicket.count.mockResolvedValue(0);
      prisma.hrTicket.findMany.mockResolvedValue([]);

      const stats = await service.getStats(tenantId);

      expect(stats.avgResolutionHours).toBeNull();
    });
  });
});
