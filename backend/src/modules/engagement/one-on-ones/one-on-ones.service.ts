import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, NotificationType, OneOnOneStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  AddActionItemDto,
  CreateOneOnOneDto,
  ListOneOnOnesDto,
  UpdateActionItemDto,
  UpdateOneOnOneDto,
  UpsertPrivateNoteDto,
} from './dto/one-on-one.dto';

const counterpartSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
};

/** Format a date the way employee-facing notifications do across the app. */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * One-on-one meetings between a manager and a report: shared agenda and
 * notes, action items, and a private note only its author ever sees.
 *
 * Access to a meeting (and everything under it) is restricted to its two
 * stored participants. Nobody else — including HR_ADMIN and SUPER_ADMIN —
 * can read it; they get 404, same as a meeting that doesn't exist.
 */
@Injectable()
export class OneOnOnesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getForParticipant(tenantId: string, employeeId: string, id: string) {
    const meeting = await this.prisma.oneOnOneMeeting.findFirst({
      where: { id, tenantId, OR: [{ managerId: employeeId }, { employeeId }] },
    });
    if (!meeting) {
      throw new NotFoundException('One-on-one not found');
    }
    return meeting;
  }

  async create(tenantId: string, employeeId: string, dto: CreateOneOnOneDto) {
    if (dto.counterpartId === employeeId) {
      throw new BadRequestException('You cannot schedule a one-on-one with yourself');
    }

    const [me, counterpart] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: employeeId, tenantId },
        select: { id: true, managerId: true, firstName: true, lastName: true },
      }),
      this.prisma.employee.findFirst({
        where: { id: dto.counterpartId, tenantId, status: EmployeeStatus.ACTIVE },
        select: { id: true, managerId: true, firstName: true, lastName: true },
      }),
    ]);

    if (!me || !counterpart) {
      throw new NotFoundException('Employee not found');
    }

    let managerId: string;
    let reportId: string;
    if (counterpart.managerId === employeeId) {
      // Caller is the counterpart's manager.
      managerId = employeeId;
      reportId = counterpart.id;
    } else if (me.managerId === dto.counterpartId) {
      // Caller reports to the counterpart.
      managerId = counterpart.id;
      reportId = employeeId;
    } else {
      throw new ForbiddenException(
        'You can only schedule one-on-ones with your manager or direct reports',
      );
    }

    const meeting = await this.prisma.oneOnOneMeeting.create({
      data: {
        tenantId,
        managerId,
        employeeId: reportId,
        scheduledAt: new Date(dto.scheduledAt),
        agenda: dto.agenda,
        createdById: employeeId,
      },
    });

    try {
      await this.notificationsService.notifyEmployee(
        tenantId,
        dto.counterpartId,
        NotificationType.ONE_ON_ONE_SCHEDULED,
        'One-on-one scheduled',
        `${me.firstName} ${me.lastName} scheduled a one-on-one for ${formatDate(meeting.scheduledAt)}`,
        `/one-on-ones/${meeting.id}`,
      );
    } catch {
      // Best-effort: a notification failure never fails the schedule.
    }

    return meeting;
  }

  async list(tenantId: string, employeeId: string, query: ListOneOnOnesDto) {
    const participantFilter = { OR: [{ managerId: employeeId }, { employeeId }] };
    const where: any = { tenantId, ...participantFilter };
    if (query.status) {
      where.status = query.status;
    }
    if (query.counterpartId) {
      delete where.OR;
      where.AND = [
        participantFilter,
        { OR: [{ managerId: query.counterpartId }, { employeeId: query.counterpartId }] },
      ];
    }

    const meetings = await this.prisma.oneOnOneMeeting.findMany({
      where,
      orderBy: { scheduledAt: 'desc' },
    });

    const counterpartIds = Array.from(
      new Set(meetings.map((m) => (m.managerId === employeeId ? m.employeeId : m.managerId))),
    );
    const counterparts = counterpartIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: counterpartIds }, tenantId },
          select: counterpartSelect,
        })
      : [];
    const counterpartById = new Map(counterparts.map((c) => [c.id, c]));

    return meetings.map((m) => {
      const counterpartId = m.managerId === employeeId ? m.employeeId : m.managerId;
      return {
        ...m,
        myRole: m.managerId === employeeId ? 'MANAGER' : 'REPORT',
        counterpart: counterpartById.get(counterpartId) ?? null,
      };
    });
  }

  async openItems(tenantId: string, employeeId: string, counterpartId: string) {
    const meetings = await this.prisma.oneOnOneMeeting.findMany({
      where: {
        tenantId,
        OR: [
          { managerId: employeeId, employeeId: counterpartId },
          { managerId: counterpartId, employeeId },
        ],
      },
      select: { id: true },
    });
    const meetingIds = meetings.map((m) => m.id);
    if (meetingIds.length === 0) {
      return [];
    }
    return this.prisma.oneOnOneActionItem.findMany({
      where: { tenantId, meetingId: { in: meetingIds }, isDone: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  async counterparts(tenantId: string, employeeId: string) {
    const me = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { managerId: true },
    });

    const [manager, reports] = await Promise.all([
      me?.managerId
        ? this.prisma.employee.findFirst({
            where: { id: me.managerId, tenantId, status: EmployeeStatus.ACTIVE },
            select: counterpartSelect,
          })
        : Promise.resolve(null),
      this.prisma.employee.findMany({
        where: { managerId: employeeId, tenantId, status: EmployeeStatus.ACTIVE },
        select: counterpartSelect,
        orderBy: { firstName: 'asc' },
      }),
    ]);

    const result: Array<{
      id: string;
      firstName: string;
      lastName: string;
      employeeCode: string;
      relation: 'MANAGER' | 'REPORT';
    }> = [];
    if (manager) {
      result.push({ ...manager, relation: 'MANAGER' });
    }
    for (const report of reports) {
      result.push({ ...report, relation: 'REPORT' });
    }
    return result;
  }

  async get(tenantId: string, employeeId: string, id: string) {
    const meeting = await this.getForParticipant(tenantId, employeeId, id);
    const counterpartId = meeting.managerId === employeeId ? meeting.employeeId : meeting.managerId;
    const myRole = meeting.managerId === employeeId ? 'MANAGER' : 'REPORT';

    const [counterpart, actionItems, privateNote] = await Promise.all([
      this.prisma.employee.findFirst({
        where: { id: counterpartId, tenantId },
        select: counterpartSelect,
      }),
      this.prisma.oneOnOneActionItem.findMany({
        where: { meetingId: id, tenantId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.oneOnOnePrivateNote.findUnique({
        where: { meetingId_authorId: { meetingId: id, authorId: employeeId } },
      }),
    ]);

    return {
      ...meeting,
      counterpart: counterpart ?? null,
      myRole,
      actionItems,
      myPrivateNote: privateNote?.content ?? null,
    };
  }

  async update(tenantId: string, employeeId: string, id: string, dto: UpdateOneOnOneDto) {
    const meeting = await this.getForParticipant(tenantId, employeeId, id);

    if (meeting.status === OneOnOneStatus.CANCELLED && dto.status === OneOnOneStatus.SCHEDULED) {
      throw new BadRequestException('A cancelled one-on-one cannot be rescheduled');
    }

    const data: any = {};
    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = new Date(dto.scheduledAt);
    }
    if (dto.agenda !== undefined) {
      data.agenda = dto.agenda;
    }
    if (dto.sharedNotes !== undefined) {
      data.sharedNotes = dto.sharedNotes;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === OneOnOneStatus.COMPLETED) {
        data.completedAt = new Date();
      }
    }

    return this.prisma.oneOnOneMeeting.update({ where: { id }, data });
  }

  async addItem(tenantId: string, employeeId: string, meetingId: string, dto: AddActionItemDto) {
    const meeting = await this.getForParticipant(tenantId, employeeId, meetingId);

    if (dto.assigneeId !== meeting.managerId && dto.assigneeId !== meeting.employeeId) {
      throw new BadRequestException('Assignee must be a participant in this one-on-one');
    }

    return this.prisma.oneOnOneActionItem.create({
      data: {
        tenantId,
        meetingId,
        text: dto.text,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  private async getItemOrFail(tenantId: string, meetingId: string, itemId: string) {
    const item = await this.prisma.oneOnOneActionItem.findFirst({
      where: { id: itemId, meetingId, tenantId },
    });
    if (!item) {
      throw new NotFoundException('Action item not found');
    }
    return item;
  }

  async updateItem(
    tenantId: string,
    employeeId: string,
    meetingId: string,
    itemId: string,
    dto: UpdateActionItemDto,
  ) {
    await this.getForParticipant(tenantId, employeeId, meetingId);
    await this.getItemOrFail(tenantId, meetingId, itemId);

    const data: any = {};
    if (dto.text !== undefined) {
      data.text = dto.text;
    }
    if (dto.isDone !== undefined) {
      data.isDone = dto.isDone;
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    return this.prisma.oneOnOneActionItem.update({ where: { id: itemId }, data });
  }

  async removeItem(tenantId: string, employeeId: string, meetingId: string, itemId: string) {
    await this.getForParticipant(tenantId, employeeId, meetingId);
    await this.getItemOrFail(tenantId, meetingId, itemId);

    return this.prisma.oneOnOneActionItem.delete({ where: { id: itemId } });
  }

  async upsertPrivateNote(
    tenantId: string,
    employeeId: string,
    meetingId: string,
    dto: UpsertPrivateNoteDto,
  ) {
    await this.getForParticipant(tenantId, employeeId, meetingId);

    const trimmed = dto.content.trim();
    if (!trimmed) {
      await this.prisma.oneOnOnePrivateNote.deleteMany({
        where: { meetingId, authorId: employeeId },
      });
      return { content: null };
    }

    const note = await this.prisma.oneOnOnePrivateNote.upsert({
      where: { meetingId_authorId: { meetingId, authorId: employeeId } },
      create: { tenantId, meetingId, authorId: employeeId, content: trimmed },
      update: { content: trimmed },
    });
    return note;
  }
}
