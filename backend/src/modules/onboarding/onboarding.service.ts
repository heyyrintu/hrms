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
  CreateOnboardingTemplateDto,
  UpdateOnboardingTemplateDto,
  CreateOnboardingProcessDto,
  UpdateOnboardingTaskDto,
  OnboardingQueryDto,
} from './dto/onboarding.dto';
import {
  OnboardingProcessStatus,
  OnboardingTaskStatus,
  NotificationType,
} from '@prisma/client';

@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================
  // Templates (Admin)
  // ============================================

  async getTemplates(tenantId: string) {
    return this.prisma.onboardingTemplate.findMany({
      where: { tenantId },
      include: { _count: { select: { processes: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(tenantId: string, id: string) {
    const template = await this.prisma.onboardingTemplate.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { processes: true } } },
    });
    if (!template) throw new NotFoundException('Onboarding template not found');
    return template;
  }

  async createTemplate(tenantId: string, dto: CreateOnboardingTemplateDto) {
    const existing = await this.prisma.onboardingTemplate.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(`Template "${dto.name}" already exists`);
    }

    return this.prisma.onboardingTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type as any,
        description: dto.description,
        tasks: dto.tasks as any,
      },
    });
  }

  async updateTemplate(
    tenantId: string,
    id: string,
    dto: UpdateOnboardingTemplateDto,
  ) {
    const template = await this.prisma.onboardingTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!template) throw new NotFoundException('Onboarding template not found');

    if (dto.name && dto.name !== template.name) {
      const existing = await this.prisma.onboardingTemplate.findUnique({
        where: { tenantId_name: { tenantId, name: dto.name } },
      });
      if (existing) {
        throw new ConflictException(`Template "${dto.name}" already exists`);
      }
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.tasks !== undefined) data.tasks = dto.tasks;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.onboardingTemplate.update({
      where: { id },
      data,
    });
  }

  async deleteTemplate(tenantId: string, id: string) {
    const template = await this.prisma.onboardingTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!template) throw new NotFoundException('Onboarding template not found');

    const processCount = await this.prisma.onboardingProcess.count({
      where: { templateId: id },
    });
    if (processCount > 0) {
      throw new BadRequestException(
        'Cannot delete template with existing processes. Deactivate it instead.',
      );
    }

    await this.prisma.onboardingTemplate.delete({ where: { id } });
  }

  // ============================================
  // Processes (Admin)
  // ============================================

  async getProcesses(tenantId: string, query: OnboardingQueryDto) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const where: any = { tenantId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;

    const [data, total] = await Promise.all([
      this.prisma.onboardingProcess.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              designation: true,
              department: { select: { name: true } },
            },
          },
          template: { select: { id: true, name: true, type: true } },
          _count: { select: { tasks: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.onboardingProcess.count({ where }),
    ]);

    // Get completed task counts for progress
    const processIds = data.map((p) => p.id);
    const completedCounts = await this.prisma.onboardingTask.groupBy({
      by: ['processId'],
      where: {
        processId: { in: processIds },
        status: { in: [OnboardingTaskStatus.COMPLETED, OnboardingTaskStatus.SKIPPED] },
      },
      _count: true,
    });
    const completedMap = new Map(completedCounts.map((c) => [c.processId, c._count]));

    const enrichedData = data.map((p) => ({
      ...p,
      completedTaskCount: completedMap.get(p.id) || 0,
    }));

    return {
      data: enrichedData,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProcess(tenantId: string, id: string) {
    const process = await this.prisma.onboardingProcess.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            designation: true,
            department: { select: { name: true } },
          },
        },
        template: { select: { id: true, name: true, type: true } },
        tasks: {
          include: {
            assignee: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!process) throw new NotFoundException('Onboarding process not found');
    return process;
  }

  async createProcess(tenantId: string, dto: CreateOnboardingProcessDto) {
    // Validate template
    const template = await this.prisma.onboardingTemplate.findFirst({
      where: { id: dto.templateId, tenantId, isActive: true },
    });
    if (!template) {
      throw new NotFoundException('Template not found or inactive');
    }

    // Validate employee
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId, status: 'ACTIVE' },
      select: { id: true, managerId: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found or inactive');
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const taskDefs = (template.tasks as any[]) || [];

    // Resolve assignee IDs
    const resolveAssignee = async (role?: string): Promise<string | null> => {
      if (!role) return null;
      if (role === 'EMPLOYEE') return employee.id;
      if (role === 'MANAGER') return employee.managerId || null;
      if (role === 'HR_ADMIN') {
        const hrUser = await this.prisma.user.findFirst({
          where: { tenantId, role: 'HR_ADMIN', isActive: true, employeeId: { not: null } },
          select: { employeeId: true },
        });
        return hrUser?.employeeId || null;
      }
      return null;
    };

    // Build task data
    const taskDataPromises = taskDefs.map(async (td) => {
      const assigneeId = await resolveAssignee(td.defaultAssigneeRole);
      const dueDate =
        td.daysAfterStart != null
          ? new Date(startDate.getTime() + td.daysAfterStart * 86400000)
          : null;

      return {
        tenantId,
        title: td.title,
        description: td.description || null,
        category: td.category || 'GENERAL',
        assigneeId,
        dueDate,
        sortOrder: td.sortOrder || 0,
      };
    });

    const taskData = await Promise.all(taskDataPromises);

    // Create process + tasks in transaction
    const process = await this.prisma.$transaction(async (tx) => {
      const proc = await tx.onboardingProcess.create({
        data: {
          tenantId,
          employeeId: dto.employeeId,
          templateId: dto.templateId,
          type: template.type,
          startDate,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
          notes: dto.notes,
        },
      });

      await tx.onboardingTask.createMany({
        data: taskData.map((td) => ({
          ...td,
          processId: proc.id,
        })),
      });

      return proc;
    });

    // Notify assignees (fire-and-forget)
    const uniqueAssignees = [...new Set(taskData.map((t) => t.assigneeId).filter(Boolean))] as string[];
    for (const assigneeId of uniqueAssignees) {
      this.notificationsService
        .notifyEmployee(
          tenantId,
          assigneeId,
          NotificationType.ONBOARDING_TASK_ASSIGNED,
          'Onboarding Task Assigned',
          `You have been assigned onboarding tasks. Please check your task list.`,
          '/onboarding/my-tasks',
        )
        .catch(() => {});
    }

    // Return the full process
    return this.getProcess(tenantId, process.id);
  }

  async cancelProcess(tenantId: string, id: string) {
    const process = await this.prisma.onboardingProcess.findFirst({
      where: { id, tenantId },
    });
    if (!process) throw new NotFoundException('Onboarding process not found');
    if (process.status === OnboardingProcessStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed process');
    }
    if (process.status === OnboardingProcessStatus.CANCELLED) {
      throw new BadRequestException('Process is already cancelled');
    }

    await this.prisma.$transaction([
      this.prisma.onboardingProcess.update({
        where: { id },
        data: { status: OnboardingProcessStatus.CANCELLED },
      }),
      this.prisma.onboardingTask.updateMany({
        where: {
          processId: id,
          status: { in: [OnboardingTaskStatus.PENDING, OnboardingTaskStatus.IN_PROGRESS] },
        },
        data: { status: OnboardingTaskStatus.SKIPPED },
      }),
    ]);

    return this.getProcess(tenantId, id);
  }

  async deleteProcess(tenantId: string, id: string) {
    const process = await this.prisma.onboardingProcess.findFirst({
      where: { id, tenantId },
    });
    if (!process) throw new NotFoundException('Onboarding process not found');
    if (process.status !== OnboardingProcessStatus.NOT_STARTED) {
      throw new BadRequestException('Only NOT_STARTED processes can be deleted');
    }

    // Tasks cascade-delete thanks to onDelete: Cascade
    await this.prisma.onboardingProcess.delete({ where: { id } });
  }

  // ============================================
  // Tasks
  // ============================================

  async getMyTasks(tenantId: string, employeeId: string, query: OnboardingQueryDto) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const where: any = { tenantId, assigneeId: employeeId };
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.onboardingTask.findMany({
        where,
        include: {
          process: {
            select: {
              id: true,
              type: true,
              status: true,
              employee: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.onboardingTask.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateTask(
    tenantId: string,
    taskId: string,
    userId: string,
    userRole: string,
    dto: UpdateOnboardingTaskDto,
  ) {
    const task = await this.prisma.onboardingTask.findFirst({
      where: { id: taskId, tenantId },
      include: { process: { select: { status: true } } },
    });
    if (!task) throw new NotFoundException('Onboarding task not found');

    // Auth: non-admin can only update their own tasks
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'HR_ADMIN') {
      if (task.assigneeId !== userId) {
        throw new ForbiddenException('You can only update tasks assigned to you');
      }
    }

    if (task.process.status === OnboardingProcessStatus.CANCELLED) {
      throw new BadRequestException('Cannot update tasks in a cancelled process');
    }

    const data: any = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId;
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (dto.status === 'COMPLETED') {
      data.completedAt = new Date();
    }

    const updated = await this.prisma.onboardingTask.update({
      where: { id: taskId },
      data,
    });

    // Notify new assignee if changed
    if (dto.assigneeId && dto.assigneeId !== task.assigneeId) {
      this.notificationsService
        .notifyEmployee(
          tenantId,
          dto.assigneeId,
          NotificationType.ONBOARDING_TASK_ASSIGNED,
          'Onboarding Task Assigned',
          `You have been assigned a new task: "${task.title}"`,
          '/onboarding/my-tasks',
        )
        .catch(() => {});
    }

    // Auto-advance/complete process
    await this.checkProcessStatus(tenantId, task.processId, dto.status);

    return updated;
  }

  async completeTask(tenantId: string, taskId: string, userId: string, userRole: string) {
    return this.updateTask(tenantId, taskId, userId, userRole, {
      status: 'COMPLETED',
    });
  }

  private async checkProcessStatus(tenantId: string, processId: string, newTaskStatus?: string) {
    const process = await this.prisma.onboardingProcess.findFirst({
      where: { id: processId, tenantId },
    });
    if (!process) return;

    // Auto-advance to IN_PROGRESS when first task starts
    if (
      process.status === OnboardingProcessStatus.NOT_STARTED &&
      (newTaskStatus === 'IN_PROGRESS' || newTaskStatus === 'COMPLETED')
    ) {
      await this.prisma.onboardingProcess.update({
        where: { id: processId },
        data: { status: OnboardingProcessStatus.IN_PROGRESS },
      });
    }

    // Check if all tasks are done (COMPLETED or SKIPPED)
    const pendingTasks = await this.prisma.onboardingTask.count({
      where: {
        processId,
        status: { in: [OnboardingTaskStatus.PENDING, OnboardingTaskStatus.IN_PROGRESS] },
      },
    });

    if (pendingTasks === 0 && process.status !== OnboardingProcessStatus.COMPLETED) {
      await this.prisma.onboardingProcess.update({
        where: { id: processId },
        data: {
          status: OnboardingProcessStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // Notify HR about completion
      this.notificationsService
        .notifyByRole(
          tenantId,
          ['HR_ADMIN'],
          NotificationType.ONBOARDING_COMPLETED,
          'Onboarding Process Completed',
          `An onboarding process has been completed. All tasks are done.`,
          '/onboarding',
        )
        .catch(() => {});
    }
  }
}
