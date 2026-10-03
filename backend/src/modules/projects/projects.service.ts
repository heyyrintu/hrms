import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { canManageProject, isProjectAdmin } from './project-access';
import { CreateProjectDto, ProjectListQueryDto, UpdateProjectDto } from './dto/project.dto';

const CODE_RE = /^[A-Z0-9-]{2,20}$/;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` -> UTC-midnight Date; 400 when it is not a real calendar day. */
export function parseDay(value: string, field = 'date'): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date`);
  }
  return d;
}

export function formatDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const projectInclude = {
  manager: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { members: true, tasks: true } },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

/** Projects (Keka wave G, WS-P). */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(p: ProjectRow, actor: AuthenticatedUser) {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      clientName: p.clientName,
      description: p.description,
      billable: p.billable,
      status: p.status,
      startDate: formatDay(p.startDate),
      endDate: formatDay(p.endDate),
      managerEmployeeId: p.managerEmployeeId,
      manager: p.manager
        ? { id: p.manager.id, name: `${p.manager.firstName} ${p.manager.lastName}` }
        : null,
      memberCount: p._count?.members ?? 0,
      taskCount: p._count?.tasks ?? 0,
      canManage: canManageProject(actor, p),
    };
  }

  /** Visibility predicate for non-admins; `null` when they can see nothing. */
  private visibility(actor: AuthenticatedUser): Prisma.ProjectWhereInput | null {
    if (!actor.employeeId) return null;
    return {
      OR: [
        { managerEmployeeId: actor.employeeId },
        { members: { some: { employeeId: actor.employeeId } } },
      ],
    };
  }

  private assertAdmin(actor: AuthenticatedUser) {
    if (!isProjectAdmin(actor)) {
      throw new ForbiddenException('Only project admins can do this');
    }
  }

  private checkCode(raw: string): string {
    const code = raw.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      throw new BadRequestException(
        'Project code must be 2-20 characters of A-Z, 0-9 or "-"',
      );
    }
    return code;
  }

  private async assertActiveEmployee(tenantId: string, employeeId: string) {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!emp) throw new BadRequestException('Manager must be an active employee');
  }

  async list(actor: AuthenticatedUser, q: ProjectListQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    const where: Prisma.ProjectWhereInput = { tenantId: actor.tenantId };
    if (q.status) where.status = q.status;
    if (!isProjectAdmin(actor)) {
      const vis = this.visibility(actor);
      if (!vis) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      Object.assign(where, vis);
    }
    const search = q.search?.trim();
    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            { clientName: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: projectInclude,
        orderBy: [{ status: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.project.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toDto(r, actor)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private async findVisible<T extends Prisma.ProjectInclude | undefined>(
    actor: AuthenticatedUser,
    id: string,
    include?: T,
  ) {
    const where: Prisma.ProjectWhereInput = { id, tenantId: actor.tenantId };
    if (!isProjectAdmin(actor)) {
      const vis = this.visibility(actor);
      if (!vis) throw new NotFoundException('Project not found');
      Object.assign(where, vis);
    }
    const project = await this.prisma.project.findFirst({ where, ...(include ? { include } : {}) });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /** The project when the actor can see it, else 404. */
  async assertVisible(actor: AuthenticatedUser, id: string) {
    return this.findVisible(actor, id);
  }

  /** The project when the actor can manage it (404 not visible, 403 visible only). */
  async assertManageable(actor: AuthenticatedUser, id: string) {
    const project = await this.findVisible(actor, id);
    if (!canManageProject(actor, project)) {
      throw new ForbiddenException('Only the project manager or an admin can do this');
    }
    return project;
  }

  async get(actor: AuthenticatedUser, id: string) {
    const project = (await this.findVisible(actor, id, projectInclude)) as ProjectRow;
    return this.toDto(project, actor);
  }

  async create(actor: AuthenticatedUser, dto: CreateProjectDto) {
    this.assertAdmin(actor);
    const code = this.checkCode(dto.code);
    const start = dto.startDate ? parseDay(dto.startDate, 'startDate') : null;
    const end = dto.endDate ? parseDay(dto.endDate, 'endDate') : null;
    if (start && end && end < start) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if (dto.managerEmployeeId) {
      await this.assertActiveEmployee(actor.tenantId, dto.managerEmployeeId);
    }
    const dup = await this.prisma.project.findFirst({
      where: { tenantId: actor.tenantId, code },
      select: { id: true },
    });
    if (dup) throw new ConflictException(`Project code ${code} already exists`);
    try {
      const created = await this.prisma.project.create({
        data: {
          tenantId: actor.tenantId,
          code,
          name: dto.name.trim(),
          clientName: dto.clientName ?? null,
          description: dto.description ?? null,
          billable: dto.billable ?? true,
          status: dto.status ?? 'ACTIVE',
          startDate: start,
          endDate: end,
          managerEmployeeId: dto.managerEmployeeId ?? null,
          createdById: actor.userId,
        },
        include: projectInclude,
      });
      return this.toDto(created, actor);
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException(`Project code ${code} already exists`);
      }
      throw e;
    }
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateProjectDto) {
    this.assertAdmin(actor);
    const existing = await this.prisma.project.findFirst({
      where: { id, tenantId: actor.tenantId },
    });
    if (!existing) throw new NotFoundException('Project not found');

    const data: Prisma.ProjectUncheckedUpdateInput = {};
    if (dto.code !== undefined) {
      const code = this.checkCode(dto.code);
      if (code !== existing.code) {
        const dup = await this.prisma.project.findFirst({
          where: { tenantId: actor.tenantId, code, NOT: { id } },
          select: { id: true },
        });
        if (dup) throw new ConflictException(`Project code ${code} already exists`);
      }
      data.code = code;
    }
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.clientName !== undefined) data.clientName = dto.clientName;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.billable !== undefined) data.billable = dto.billable;
    if (dto.status !== undefined) data.status = dto.status;

    const start =
      dto.startDate === undefined
        ? existing.startDate
        : dto.startDate === null
          ? null
          : parseDay(dto.startDate, 'startDate');
    const end =
      dto.endDate === undefined
        ? existing.endDate
        : dto.endDate === null
          ? null
          : parseDay(dto.endDate, 'endDate');
    if (start && end && end < start) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if (dto.startDate !== undefined) data.startDate = start;
    if (dto.endDate !== undefined) data.endDate = end;

    if (dto.managerEmployeeId !== undefined) {
      if (dto.managerEmployeeId) {
        await this.assertActiveEmployee(actor.tenantId, dto.managerEmployeeId);
      }
      data.managerEmployeeId = dto.managerEmployeeId;
    }

    try {
      const updated = await this.prisma.project.update({
        where: { id },
        data,
        include: projectInclude,
      });
      return this.toDto(updated, actor);
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('Project code already exists');
      }
      throw e;
    }
  }

  /** ACTIVE projects the caller can log hours on in the week starting `weekStart`. */
  async loggable(actor: AuthenticatedUser, weekStart: string) {
    const start = parseDay(weekStart, 'weekStart');
    if (start.getUTCDay() !== 1) {
      throw new BadRequestException('weekStart must be a Monday');
    }
    if (!actor.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    const end = new Date(start.getTime() + 6 * DAY_MS);
    const overlap = {
      employeeId: actor.employeeId,
      startDate: { lte: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
    };
    const projects = await this.prisma.project.findMany({
      where: {
        tenantId: actor.tenantId,
        status: 'ACTIVE',
        members: { some: overlap },
      },
      include: {
        members: { where: { employeeId: actor.employeeId }, take: 1 },
        tasks: { where: { status: 'OPEN' }, orderBy: { name: 'asc' } },
      },
      orderBy: { code: 'asc' },
    });
    return projects.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      billable: p.billable,
      member: {
        startDate: formatDay(p.members[0]?.startDate) as string,
        endDate: formatDay(p.members[0]?.endDate),
      },
      tasks: p.tasks.map((t) => ({
        id: t.id,
        name: t.name,
        billable: t.billable,
        effectiveBillable: t.billable ?? p.billable,
      })),
    }));
  }
}
