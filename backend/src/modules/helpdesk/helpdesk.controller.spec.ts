import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { HelpdeskController } from './helpdesk.controller';
import { HelpdeskService } from './helpdesk.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { TicketPriority, TicketStatus, UserRole } from '@prisma/client';

const mockService = {
  listCategories: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  createTicket: jest.fn(),
  findMyTickets: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  assign: jest.fn(),
  changeStatus: jest.fn(),
  addComment: jest.fn(),
  getStats: jest.fn(),
};

describe('HelpdeskController', () => {
  let controller: HelpdeskController;
  let service: typeof mockService;

  const employeeUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  const hrUser: AuthenticatedUser = {
    userId: 'user-hr',
    email: 'hr@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-hr',
  };

  const orphanUser: AuthenticatedUser = {
    userId: 'user-orphan',
    email: 'orphan@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HelpdeskController],
      providers: [{ provide: HelpdeskService, useValue: mockService }],
    }).compile();
    controller = module.get<HelpdeskController>(HelpdeskController);
    service = module.get(HelpdeskService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // Categories
  // ============================================

  describe('categories', () => {
    it('lists only active categories for a plain employee', async () => {
      service.listCategories.mockResolvedValue([]);

      await controller.listCategories(employeeUser, 'true');

      expect(service.listCategories).toHaveBeenCalledWith('tenant-1', false);
    });

    it('lets HR ask for the inactive ones too', async () => {
      service.listCategories.mockResolvedValue([]);

      await controller.listCategories(hrUser, 'true');

      expect(service.listCategories).toHaveBeenCalledWith('tenant-1', true);
    });

    it('creates a category in the caller tenant', async () => {
      service.createCategory.mockResolvedValue({ id: 'cat-1' });
      const dto = { name: 'Payroll', code: 'PAY' };

      await controller.createCategory(hrUser, dto);

      expect(service.createCategory).toHaveBeenCalledWith('tenant-1', dto);
    });

    it('updates a category by id', async () => {
      service.updateCategory.mockResolvedValue({ id: 'cat-1' });

      await controller.updateCategory(hrUser, 'cat-1', { slaHours: 12 });

      expect(service.updateCategory).toHaveBeenCalledWith('tenant-1', 'cat-1', {
        slaHours: 12,
      });
    });
  });

  // ============================================
  // Tickets
  // ============================================

  describe('createTicket', () => {
    const dto = {
      categoryId: 'cat-1',
      subject: 'Payslip missing',
      description: 'No March payslip',
      priority: TicketPriority.HIGH,
    };

    it('raises the ticket for the caller employee', async () => {
      service.createTicket.mockResolvedValue({ id: 'ticket-1' });

      await controller.createTicket(employeeUser, dto);

      expect(service.createTicket).toHaveBeenCalledWith('tenant-1', 'emp-1', dto);
    });

    it('refuses a caller with no employee record', async () => {
      await expect(controller.createTicket(orphanUser, dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(service.createTicket).not.toHaveBeenCalled();
    });
  });

  describe('findMyTickets', () => {
    it('passes the caller employee and the query through', async () => {
      service.findMyTickets.mockResolvedValue({ data: [], meta: {} });

      await controller.findMyTickets(employeeUser, { status: TicketStatus.OPEN });

      expect(service.findMyTickets).toHaveBeenCalledWith('tenant-1', 'emp-1', {
        status: TicketStatus.OPEN,
      });
    });

    it('refuses a caller with no employee record', async () => {
      await expect(controller.findMyTickets(orphanUser, {})).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findAll', () => {
    it('passes the queue filters through', async () => {
      service.findAll.mockResolvedValue({ data: [], meta: {} });

      await controller.findAll(hrUser, { overdue: true });

      expect(service.findAll).toHaveBeenCalledWith('tenant-1', { overdue: true });
    });
  });

  describe('findById', () => {
    it('hands the whole caller to the service so it can decide access', async () => {
      service.findById.mockResolvedValue({ id: 'ticket-1' });

      await controller.findById(employeeUser, 'ticket-1');

      expect(service.findById).toHaveBeenCalledWith(
        'tenant-1',
        'ticket-1',
        employeeUser,
      );
    });
  });

  describe('assign', () => {
    it('assigns by user id', async () => {
      service.assign.mockResolvedValue({ id: 'ticket-1' });

      await controller.assign(hrUser, 'ticket-1', { assignedToId: 'user-agent' });

      expect(service.assign).toHaveBeenCalledWith('tenant-1', 'ticket-1', {
        assignedToId: 'user-agent',
      });
    });
  });

  describe('changeStatus', () => {
    it('passes the caller so the transition table can rank them', async () => {
      service.changeStatus.mockResolvedValue({ id: 'ticket-1' });

      await controller.changeStatus(employeeUser, 'ticket-1', {
        status: TicketStatus.CLOSED,
      });

      expect(service.changeStatus).toHaveBeenCalledWith(
        'tenant-1',
        'ticket-1',
        { status: TicketStatus.CLOSED },
        employeeUser,
      );
    });
  });

  describe('addComment', () => {
    it('passes the caller so internal notes can be gated', async () => {
      service.addComment.mockResolvedValue({ id: 'c-1' });

      await controller.addComment(hrUser, 'ticket-1', {
        content: 'Escalated',
        isInternal: true,
      });

      expect(service.addComment).toHaveBeenCalledWith(
        'tenant-1',
        'ticket-1',
        { content: 'Escalated', isInternal: true },
        hrUser,
      );
    });
  });

  describe('getStats', () => {
    it('scopes the stats to the caller tenant', async () => {
      service.getStats.mockResolvedValue({
        byStatus: {},
        overdue: 0,
        avgResolutionHours: null,
      });

      await controller.getStats(hrUser);

      expect(service.getStats).toHaveBeenCalledWith('tenant-1');
    });
  });
});
