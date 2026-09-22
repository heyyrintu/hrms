import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationType,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  TicketActor,
  allowedNextStatuses,
  canTransition,
} from './ticket-transitions';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';

/** Enough of an employee to name them on a ticket row. */
const employeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
};

/** The agent a ticket sits with. `assignedToId` is a User id, not an Employee id. */
const assigneeSelect = {
  id: true,
  email: true,
  employeeId: true,
};

const ticketInclude = {
  employee: { select: employeeSelect },
  category: { select: { id: true, name: true, code: true, slaHours: true } },
  assignedTo: { select: assigneeSelect },
};

const CLOSED_STATUSES: TicketStatus[] = [
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
];

const HOUR_MS = 60 * 60 * 1000;
const STATS_WINDOW_DAYS = 30;

export interface HelpdeskStats {
  byStatus: Record<TicketStatus, number>;
  overdue: number;
  avgResolutionHours: number | null;
}

@Injectable()
export class HelpdeskService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  private isHr(role: UserRole) {
    return role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
  }

  /**
   * Which hat the caller is wearing on this ticket. HR outranks everyone, and
   * the assignee outranks the owner — so staff who are also the raiser get the
   * wider rights. The one exception is the raiser themselves: OWNER is checked
   * before ASSIGNEE so a non-HR employee can never be promoted out of the
   * owner rules by being assigned their own ticket. `null` means they have no
   * business reading the ticket at all.
   */
  private actorFor(
    ticket: { employeeId: string; assignedToId: string | null },
    user: AuthenticatedUser,
  ): TicketActor | null {
    if (this.isHr(user.role)) return 'HR';

    // An undefined employeeId must never be allowed to match: it would make
    // every ticket look like the caller's own.
    const isOwner = Boolean(user.employeeId && ticket.employeeId === user.employeeId);

    // OWNER wins over ASSIGNEE for the raiser, even though ASSIGNEE is the
    // wider hat. A raiser who somehow ends up holding their own ticket must
    // not be promoted out of the owner rules: ASSIGNEE would hand them the
    // internal comments the isInternal flag exists to hide and the staff
    // transition table, which lets them resolve their own ticket.
    if (isOwner) return 'OWNER';

    if (ticket.assignedToId && ticket.assignedToId === user.userId) {
      return 'ASSIGNEE';
    }
    return null;
  }

  // ============================================
  // Categories
  // ============================================

  async listCategories(tenantId: string, includeInactive = false) {
    return this.prisma.hrTicketCategory.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(tenantId: string, dto: CreateCategoryDto) {
    const existing = await this.prisma.hrTicketCategory.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `A category with code ${dto.code} already exists`,
      );
    }

    return this.prisma.hrTicketCategory.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        description: dto.description,
        slaHours: dto.slaHours ?? 48,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateCategory(tenantId: string, id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.hrTicketCategory.findFirst({
      where: { id, tenantId },
      select: { id: true, code: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (dto.code && dto.code !== category.code) {
      const clash = await this.prisma.hrTicketCategory.findFirst({
        where: { tenantId, code: dto.code, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `A category with code ${dto.code} already exists`,
        );
      }
    }

    // Only the keys the caller actually sent, so a partial update does not
    // blank the rest of the row.
    const data: Record<string, unknown> = {};
    for (const key of [
      'name',
      'code',
      'description',
      'slaHours',
      'isActive',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }

    return this.prisma.hrTicketCategory.update({ where: { id }, data });
  }

  /**
   * The people a ticket can be handed to: the tenant's active HR users.
   * `assignedToId` is a User id, so this returns users rather than employees,
   * with the employee name attached where there is one.
   */
  async listAgents(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        role: { in: [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN] },
      },
      select: {
        id: true,
        email: true,
        employeeId: true,
        employee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { email: 'asc' },
    } as any);

    return (users as any[]).map((u) => ({
      id: u.id,
      email: u.email,
      employeeId: u.employeeId,
      name: u.employee
        ? `${u.employee.firstName} ${u.employee.lastName}`
        : u.email,
    }));
  }

  // ============================================
  // Tickets
  // ============================================

  async createTicket(
    tenantId: string,
    employeeId: string,
    dto: CreateTicketDto,
  ) {
    if (!employeeId) {
      throw new ForbiddenException('User is not linked to an employee');
    }

    const category = await this.prisma.hrTicketCategory.findFirst({
      where: { id: dto.categoryId, tenantId, isActive: true },
      select: { id: true, slaHours: true },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const now = new Date();
    const data = {
      tenantId,
      employeeId,
      categoryId: category.id,
      subject: dto.subject,
      description: dto.description,
      priority: dto.priority ?? TicketPriority.MEDIUM,
      status: TicketStatus.OPEN,
      slaDeadline: new Date(now.getTime() + category.slaHours * HOUR_MS),
    };

    const ticket = await this.createNumbered(tenantId, data);

    await this.notificationsService.notifyByRole(
      tenantId,
      [UserRole.HR_ADMIN],
      NotificationType.TICKET_CREATED,
      'New helpdesk ticket',
      `#${ticket.ticketNumber} — ${ticket.subject}`,
      `/admin/helpdesk?ticket=${ticket.id}`,
    );

    return ticket;
  }

  /**
   * Allocates the per-tenant ticket number and creates the row in one
   * transaction, so two concurrent creates cannot read the same maximum.
   * The `(tenantId, ticketNumber)` unique index is the backstop: if a racing
   * transaction committed first we get P2002, and re-reading the maximum once
   * is enough to land on the next free number.
   */
  private async createNumbered(
    tenantId: string,
    data: Record<string, unknown>,
    attempt = 0,
  ): Promise<any> {
    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const max = await tx.hrTicket.aggregate({
          where: { tenantId },
          _max: { ticketNumber: true },
        });
        const ticketNumber = (max?._max?.ticketNumber ?? 0) + 1;

        return tx.hrTicket.create({
          data: { ...data, ticketNumber },
          include: ticketInclude,
        });
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002' && attempt === 0) {
        return this.createNumbered(tenantId, data, attempt + 1);
      }
      throw error;
    }
  }

  async findMyTickets(
    tenantId: string,
    employeeId: string,
    query: ListTicketsDto,
  ) {
    if (!employeeId) {
      throw new ForbiddenException('User is not linked to an employee');
    }
    return this.paginate({ ...this.filters(query), tenantId, employeeId }, query);
  }

  async findAll(tenantId: string, query: ListTicketsDto) {
    return this.paginate({ ...this.filters(query), tenantId }, query);
  }

  /**
   * The shared filter block. `overdue` is a compound condition rather than a
   * column: past the deadline AND still owed work, so a ticket that was
   * resolved late does not sit in the overdue queue forever.
   */
  private filters(query: ListTicketsDto): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.categoryId) where.categoryId = query.categoryId;

    if (query.overdue) {
      where.slaDeadline = { lt: new Date() };
      if (!query.status) {
        where.status = { notIn: CLOSED_STATUSES };
      }
    }

    return where;
  }

  private async paginate(where: Record<string, unknown>, query: ListTicketsDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.hrTicket.findMany({
        where: where as any,
        include: ticketInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.hrTicket.count({ where: where as any }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * One ticket with its thread. Internal notes are stripped for the employee
   * who raised it — they are filtered here rather than in the query so the
   * same read serves HR, the assignee and the owner.
   */
  async findById(tenantId: string, id: string, user: AuthenticatedUser) {
    const ticket: any = await this.prisma.hrTicket.findFirst({
      where: { id, tenantId },
      include: {
        ...ticketInclude,
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: assigneeSelect },
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const actor = this.actorFor(ticket, user);
    if (!actor) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    const comments = (ticket.comments ?? []).filter(
      (comment: { isInternal: boolean }) =>
        actor !== 'OWNER' || !comment.isInternal,
    );

    return {
      ...ticket,
      comments,
      actor,
      allowedStatuses: allowedNextStatuses(ticket.status, actor),
    };
  }

  async assign(tenantId: string, id: string, dto: AssignTicketDto) {
    const ticket = await this.prisma.hrTicket.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        ticketNumber: true,
        subject: true,
        employeeId: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // Scoped by tenant so an id borrowed from another tenant reads as missing.
    const assignee = await this.prisma.user.findFirst({
      where: { id: dto.assignedToId, tenantId },
      select: { id: true, employeeId: true, role: true, isActive: true },
    });

    if (!assignee) {
      throw new NotFoundException('Assignee not found');
    }

    // Only staff hold tickets. `GET /helpdesk/agents` already filters the
    // dropdown to these roles; this is the enforcement behind it, so a
    // hand-rolled request cannot hand a ticket to an ordinary employee.
    if (!assignee.isActive || !this.isHr(assignee.role)) {
      throw new BadRequestException(
        'A ticket can only be assigned to an active HR_ADMIN or SUPER_ADMIN.',
      );
    }

    // Assigning a ticket to the person who raised it is always a mistake, and
    // an expensive one: the raiser would be reading their own ticket as staff.
    if (assignee.employeeId && assignee.employeeId === ticket.employeeId) {
      throw new BadRequestException(
        'A ticket cannot be assigned to the employee who raised it.',
      );
    }

    const data: Record<string, unknown> = { assignedToId: assignee.id };
    // Picking up an untouched ticket starts the clock on it; a reassignment
    // later in its life leaves the status where the agents put it.
    if (ticket.status === TicketStatus.OPEN) {
      data.status = TicketStatus.IN_PROGRESS;
    }

    const updated = await this.prisma.hrTicket.update({
      where: { id },
      data: data as any,
      include: ticketInclude,
    });

    // A user without an employee record has nobody to notify.
    if (assignee.employeeId) {
      await this.notificationsService.notifyEmployee(
        tenantId,
        assignee.employeeId,
        NotificationType.TICKET_ASSIGNED,
        'Ticket assigned to you',
        `#${ticket.ticketNumber} — ${ticket.subject}`,
        `/helpdesk/${id}`,
      );
    }

    return updated;
  }

  async changeStatus(
    tenantId: string,
    id: string,
    dto: ChangeStatusDto,
    user: AuthenticatedUser,
  ) {
    const ticket = await this.prisma.hrTicket.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        employeeId: true,
        assignedToId: true,
        ticketNumber: true,
        subject: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const actor = this.actorFor(ticket, user);
    if (!actor) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    if (!canTransition(ticket.status, dto.status, actor)) {
      throw new BadRequestException(
        `Cannot move a ticket from ${ticket.status} to ${dto.status}`,
      );
    }

    const now = new Date();
    const data: Record<string, unknown> = { status: dto.status };
    if (dto.status === TicketStatus.RESOLVED) data.resolvedAt = now;
    if (dto.status === TicketStatus.CLOSED) data.closedAt = now;

    const updated = await this.prisma.hrTicket.update({
      where: { id },
      data: data as any,
      include: ticketInclude,
    });

    if (dto.status === TicketStatus.RESOLVED) {
      await this.notificationsService.notifyEmployee(
        tenantId,
        ticket.employeeId,
        NotificationType.TICKET_RESOLVED,
        'Ticket resolved',
        `#${ticket.ticketNumber} — ${ticket.subject}`,
        `/helpdesk/${id}`,
      );
    }

    return updated;
  }

  async addComment(
    tenantId: string,
    id: string,
    dto: AddCommentDto,
    user: AuthenticatedUser,
  ) {
    const ticket = await this.prisma.hrTicket.findFirst({
      where: { id, tenantId },
      select: { id: true, employeeId: true, assignedToId: true, status: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const actor = this.actorFor(ticket, user);
    if (!actor) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    const isInternal = dto.isInternal ?? false;
    // An internal note the owner could write would be a note they could also
    // read back, which defeats the point of the flag.
    if (isInternal && actor === 'OWNER') {
      throw new ForbiddenException('Only HR and the assignee may post internal notes');
    }

    const data = {
      tenantId,
      ticketId: id,
      authorId: user.userId,
      content: dto.content,
      isInternal,
    };
    const include = { author: { select: assigneeSelect } };

    // The ticket was parked waiting on this person, and they have just
    // answered: the reply IS the un-park. HR and the assignee commenting on a
    // parked ticket changes nothing, because it is still the employee's turn.
    const unparks =
      actor === 'OWNER' && ticket.status === TicketStatus.WAITING_ON_EMPLOYEE;

    if (!unparks) {
      return this.prisma.hrTicketComment.create({ data, include });
    }

    // Both writes or neither, so a reply can never be recorded against a
    // ticket that stayed parked. The update is conditioned on the status we
    // read, so a concurrent change by HR wins rather than being clobbered.
    return this.prisma.$transaction(async (tx: any) => {
      const comment = await tx.hrTicketComment.create({ data, include });
      await tx.hrTicket.updateMany({
        where: { id, tenantId, status: TicketStatus.WAITING_ON_EMPLOYEE },
        data: { status: TicketStatus.IN_PROGRESS },
      });
      return comment;
    });
  }

  // ============================================
  // Stats
  // ============================================

  async getStats(tenantId: string): Promise<HelpdeskStats> {
    const now = new Date();
    const since = new Date(now.getTime() - STATS_WINDOW_DAYS * 24 * HOUR_MS);

    const [grouped, overdue, resolved] = await Promise.all([
      this.prisma.hrTicket.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      } as any),
      this.prisma.hrTicket.count({
        where: {
          tenantId,
          slaDeadline: { lt: now },
          status: { notIn: CLOSED_STATUSES },
        },
      }),
      this.prisma.hrTicket.findMany({
        where: { tenantId, resolvedAt: { gte: since } },
        select: { createdAt: true, resolvedAt: true },
      }),
    ]);

    // groupBy only returns the statuses that exist, so the zeroes are filled
    // in here and the shape is the same whatever the data looks like.
    const byStatus = Object.values(TicketStatus).reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as Record<TicketStatus, number>,
    );
    for (const row of (grouped ?? []) as any[]) {
      byStatus[row.status as TicketStatus] = row._count?._all ?? 0;
    }

    const durations = (resolved ?? [])
      .filter((t: any) => t.resolvedAt)
      .map((t: any) => (t.resolvedAt.getTime() - t.createdAt.getTime()) / HOUR_MS);

    const avgResolutionHours = durations.length
      ? Math.round(
          (durations.reduce((sum: number, h: number) => sum + h, 0) /
            durations.length) *
            100,
        ) / 100
      : null;

    return { byStatus, overdue, avgResolutionHours };
  }
}
