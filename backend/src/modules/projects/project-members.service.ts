import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { zonedDateOnlyUtc } from '../attendance/rules/late-mark';
import { AddProjectMemberDto, UpdateProjectMemberDto } from './dto/project.dto';
import { formatDay, parseDay, ProjectsService } from './projects.service';

const memberInclude = {
  employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
} satisfies Prisma.ProjectMemberInclude;

type MemberRow = Prisma.ProjectMemberGetPayload<{ include: typeof memberInclude }>;

/** Project members (Keka wave G, WS-P). */
@Injectable()
export class ProjectMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private toDto(m: MemberRow) {
    return {
      id: m.id,
      employeeId: m.employeeId,
      role: m.role,
      startDate: formatDay(m.startDate) as string,
      endDate: formatDay(m.endDate),
      employee: {
        id: m.employee.id,
        name: `${m.employee.firstName} ${m.employee.lastName}`,
        code: m.employee.employeeCode,
      },
    };
  }

  async list(actor: AuthenticatedUser, projectId: string) {
    await this.projects.assertVisible(actor, projectId);
    const rows = await this.prisma.projectMember.findMany({
      where: { tenantId: actor.tenantId, projectId },
      include: memberInclude,
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async add(actor: AuthenticatedUser, projectId: string, dto: AddProjectMemberDto) {
    await this.projects.assertManageable(actor, projectId);
    const start = dto.startDate
      ? parseDay(dto.startDate, 'startDate')
      : zonedDateOnlyUtc(new Date());
    const end = dto.endDate ? parseDay(dto.endDate, 'endDate') : null;
    if (end && end < start) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    const emp = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId: actor.tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!emp) throw new BadRequestException('Employee must be active in this tenant');
    try {
      const created = await this.prisma.projectMember.create({
        data: {
          tenantId: actor.tenantId,
          projectId,
          employeeId: dto.employeeId,
          role: dto.role ?? null,
          startDate: start,
          endDate: end,
        },
        include: memberInclude,
      });
      return this.toDto(created);
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('Employee is already a member of this project');
      }
      throw e;
    }
  }

  private async findMember(actor: AuthenticatedUser, projectId: string, memberId: string) {
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId, tenantId: actor.tenantId },
    });
    if (!member) throw new NotFoundException('Project member not found');
    return member;
  }

  async update(
    actor: AuthenticatedUser,
    projectId: string,
    memberId: string,
    dto: UpdateProjectMemberDto,
  ) {
    await this.projects.assertManageable(actor, projectId);
    const member = await this.findMember(actor, projectId, memberId);

    const data: Prisma.ProjectMemberUncheckedUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    const start = dto.startDate !== undefined ? parseDay(dto.startDate, 'startDate') : member.startDate;
    const end =
      dto.endDate === undefined
        ? member.endDate
        : dto.endDate === null
          ? null
          : parseDay(dto.endDate, 'endDate');
    if (end && end < start) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if (dto.startDate !== undefined) data.startDate = start;
    if (dto.endDate !== undefined) data.endDate = end;

    const updated = await this.prisma.projectMember.update({
      where: { id: memberId },
      data,
      include: memberInclude,
    });
    return this.toDto(updated);
  }

  /**
   * Remove a member. Hours already logged keep their history, so a member with
   * entries is ended (endDate = today) rather than deleted.
   */
  async remove(actor: AuthenticatedUser, projectId: string, memberId: string) {
    await this.projects.assertManageable(actor, projectId);
    const member = await this.findMember(actor, projectId, memberId);
    const entries = await this.prisma.timesheetEntry.count({
      where: {
        tenantId: actor.tenantId,
        projectId,
        timesheet: { employeeId: member.employeeId },
      },
    });
    if (entries > 0) {
      await this.prisma.projectMember.update({
        where: { id: memberId },
        data: { endDate: zonedDateOnlyUtc(new Date()) },
      });
      return { ended: true };
    }
    await this.prisma.projectMember.delete({ where: { id: memberId } });
    return { ended: false };
  }
}
