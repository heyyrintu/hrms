import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CreateProjectTaskDto, UpdateProjectTaskDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

type TaskRow = {
  id: string;
  name: string;
  description: string | null;
  billable: boolean | null;
  status: 'OPEN' | 'CLOSED';
  estimateHours: { toString(): string } | null;
};

/** Project tasks (Keka wave G, WS-P). */
@Injectable()
export class ProjectTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private toDto(t: TaskRow, projectBillable: boolean) {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      billable: t.billable,
      effectiveBillable: t.billable ?? projectBillable,
      status: t.status,
      estimateHours: t.estimateHours == null ? null : Number(t.estimateHours.toString()),
    };
  }

  async list(actor: AuthenticatedUser, projectId: string) {
    const project = await this.projects.assertVisible(actor, projectId);
    const rows = await this.prisma.projectTask.findMany({
      where: { tenantId: actor.tenantId, projectId },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.toDto(r as unknown as TaskRow, project.billable));
  }

  async create(actor: AuthenticatedUser, projectId: string, dto: CreateProjectTaskDto) {
    const project = await this.projects.assertManageable(actor, projectId);
    const created = await this.prisma.projectTask.create({
      data: {
        tenantId: actor.tenantId,
        projectId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        billable: dto.billable ?? null,
        estimateHours: dto.estimateHours ?? null,
      },
    });
    return this.toDto(created as unknown as TaskRow, project.billable);
  }

  private async findTask(actor: AuthenticatedUser, projectId: string, taskId: string) {
    const task = await this.prisma.projectTask.findFirst({
      where: { id: taskId, projectId, tenantId: actor.tenantId },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(
    actor: AuthenticatedUser,
    projectId: string,
    taskId: string,
    dto: UpdateProjectTaskDto,
  ) {
    const project = await this.projects.assertManageable(actor, projectId);
    await this.findTask(actor, projectId, taskId);
    const data: Prisma.ProjectTaskUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.billable !== undefined) data.billable = dto.billable;
    if (dto.estimateHours !== undefined) data.estimateHours = dto.estimateHours;
    if (dto.status !== undefined) data.status = dto.status;
    const updated = await this.prisma.projectTask.update({ where: { id: taskId }, data });
    return this.toDto(updated as unknown as TaskRow, project.billable);
  }

  async remove(actor: AuthenticatedUser, projectId: string, taskId: string) {
    await this.projects.assertManageable(actor, projectId);
    await this.findTask(actor, projectId, taskId);
    const entries = await this.prisma.timesheetEntry.count({
      where: { tenantId: actor.tenantId, taskId },
    });
    if (entries > 0) {
      throw new ConflictException('Task has logged hours; close it instead of deleting');
    }
    await this.prisma.projectTask.delete({ where: { id: taskId } });
  }
}
