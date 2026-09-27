import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobRequisitionStatus, NotificationType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowEntityContext } from '../workflow/workflow.types';
import { RequisitionView } from './recruitment.types';

export const REQUISITIONS_LINK = '/recruitment/requisitions';

const NON_TERMINAL: JobRequisitionStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'];
const EDITABLE: JobRequisitionStatus[] = ['DRAFT', 'REJECTED'];

const requisitionInclude = {
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  hiringManager: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
  _count: { select: { openings: true } },
} satisfies Prisma.JobRequisitionInclude;

type RequisitionRow = Prisma.JobRequisitionGetPayload<{ include: typeof requisitionInclude }>;

function isHr(role: UserRole): boolean {
  return role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
}

export const REQUISITION_CHANGED = 'The requisition was changed by someone else; reload and try again';

/**
 * Routing stays on the employee the requisition is for (requesterEmployeeId);
 * the maker for the self-approval rule is whoever submitted it.
 */
function contextOf(req: {
  requesterEmployeeId: string | null;
  requestedById: string;
  submittedById: string | null;
  budgetMax: Prisma.Decimal | number | string | null;
  headcount: number;
}): WorkflowEntityContext {
  return {
    requesterEmployeeId: req.requesterEmployeeId,
    requesterUserId: req.submittedById ?? req.requestedById,
    amount: req.budgetMax != null ? Number(req.budgetMax) * req.headcount : null,
  };
}

/**
 * Job requisitions, approved through the workflow engine (JOB_REQUISITION).
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, D1.
 */
@Injectable()
export class RequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApprovalEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthenticatedUser, query: { status?: string }): Promise<RequisitionView[]> {
    const where: Prisma.JobRequisitionWhereInput = { tenantId: actor.tenantId };
    if (query.status) where.status = query.status as JobRequisitionStatus;
    if (!isHr(actor.role)) where.requestedById = actor.userId;

    const rows = await this.prisma.jobRequisition.findMany({
      where,
      include: requisitionInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.toView(r)));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RequisitionView> {
    const req = await this.findOwned(actor, id);
    return this.toView(req);
  }

  async create(actor: AuthenticatedUser, input: Record<string, any>): Promise<RequisitionView> {
    await this.validateRefs(actor.tenantId, input);

    const created = await this.prisma.jobRequisition.create({
      data: {
        tenantId: actor.tenantId,
        title: input.title,
        departmentId: input.departmentId ?? null,
        designationId: input.designationId ?? null,
        hiringManagerId: input.hiringManagerId ?? null,
        headcount: input.headcount ?? 1,
        employmentType: input.employmentType ?? 'PERMANENT',
        budgetMin: input.budgetMin ?? null,
        budgetMax: input.budgetMax ?? null,
        justification: input.justification ?? null,
        status: 'DRAFT',
        requestedById: actor.userId,
        requesterEmployeeId: actor.employeeId ?? null,
      },
      include: requisitionInclude,
    });
    return this.toView(created);
  }

  async update(actor: AuthenticatedUser, id: string, input: Record<string, any>): Promise<RequisitionView> {
    const req = await this.findOwned(actor, id);
    if (!EDITABLE.includes(req.status)) {
      throw new BadRequestException('Only DRAFT or REJECTED requisitions can be edited');
    }
    if (!isHr(actor.role) && req.requestedById !== actor.userId) {
      throw new ForbiddenException('You cannot edit this requisition');
    }
    await this.validateRefs(actor.tenantId, input);

    // Guarded on the editable status: an edit racing a submit either lands
    // before it (and is covered by the approval) or fails here — never after.
    const guarded = await this.prisma.jobRequisition.updateMany({
      where: { id, tenantId: actor.tenantId, status: { in: EDITABLE } },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.designationId !== undefined ? { designationId: input.designationId } : {}),
        ...(input.hiringManagerId !== undefined ? { hiringManagerId: input.hiringManagerId } : {}),
        ...(input.headcount !== undefined ? { headcount: input.headcount } : {}),
        ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
        ...(input.budgetMin !== undefined ? { budgetMin: input.budgetMin } : {}),
        ...(input.budgetMax !== undefined ? { budgetMax: input.budgetMax } : {}),
        ...(input.justification !== undefined ? { justification: input.justification } : {}),
      },
    });
    if (guarded.count === 0) throw new ConflictException(REQUISITION_CHANGED);
    return this.toView(await this.mustExist(actor.tenantId, id));
  }

  async submit(actor: AuthenticatedUser, id: string): Promise<RequisitionView> {
    const req = await this.findOwned(actor, id);
    if (!EDITABLE.includes(req.status)) {
      throw new BadRequestException('Only DRAFT or REJECTED requisitions can be submitted');
    }
    if (!isHr(actor.role) && req.requestedById !== actor.userId) {
      throw new ForbiddenException('You cannot submit this requisition');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Maker-checker: the submitter is the workflow requester, so HR who edits
      // and submits a manager's draft cannot approve it when self-approval is
      // off. Edits are only possible while DRAFT/REJECTED (guarded), so every
      // change is covered by a later submit.
      const guarded = await tx.jobRequisition.updateMany({
        where: { id, tenantId: actor.tenantId, status: { in: EDITABLE } },
        data: {
          status: 'PENDING_APPROVAL',
          submittedById: actor.userId,
          submittedAt: new Date(),
          decidedAt: null,
          decisionNote: null,
        },
      });
      if (guarded.count === 0) throw new ConflictException(REQUISITION_CHANGED);
      // Re-read under the row lock: route on the budget as written.
      const result = await tx.jobRequisition.findFirst({
        where: { id, tenantId: actor.tenantId },
        include: requisitionInclude,
      });
      if (!result) throw new NotFoundException('Job requisition not found');
      await this.workflow.start({
        tenantId: actor.tenantId,
        entityType: 'JOB_REQUISITION',
        entityId: id,
        context: contextOf({ ...result, submittedById: actor.userId }),
        tx,
      });
      return result;
    });

    void this.workflow.notifyPending(actor.tenantId, 'JOB_REQUISITION', id);
    return this.toView(updated);
  }

  async cancel(actor: AuthenticatedUser, id: string): Promise<RequisitionView> {
    const req = await this.findOwned(actor, id);
    if (!NON_TERMINAL.includes(req.status)) {
      throw new BadRequestException('This requisition cannot be cancelled');
    }
    if (!isHr(actor.role) && req.requestedById !== actor.userId) {
      throw new ForbiddenException('You cannot cancel this requisition');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.workflow.cancel(actor.tenantId, 'JOB_REQUISITION', id, tx);
      return tx.jobRequisition.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: requisitionInclude,
      });
    });
    return this.toView(updated);
  }

  async approve(actor: AuthenticatedUser, id: string, note?: string | null): Promise<RequisitionView> {
    const req = await this.mustExist(actor.tenantId, id);

    let updated: RequisitionRow | null = null;
    const result = await this.workflow.act({
      tenantId: actor.tenantId,
      entityType: 'JOB_REQUISITION',
      entityId: id,
      actor,
      decision: 'APPROVE',
      note,
      onFinal: async (tx) => {
        updated = await tx.jobRequisition.update({
          where: { id },
          data: { status: 'APPROVED', decidedAt: new Date(), decisionNote: note ?? null },
          include: requisitionInclude,
        });
      },
    });

    if (result.outcome === 'ADVANCED' || !updated) {
      return this.get(actor, id);
    }

    this.notifications
      .create({
        tenantId: actor.tenantId,
        userId: req.requestedById,
        type: NotificationType.REQUISITION_APPROVED,
        title: 'Job requisition approved',
        message: `Your requisition for "${req.title}" has been approved.`,
        link: REQUISITIONS_LINK,
      })
      .catch(() => {});

    return this.toView(updated);
  }

  async reject(actor: AuthenticatedUser, id: string, note?: string | null): Promise<RequisitionView> {
    const req = await this.mustExist(actor.tenantId, id);

    let updated: RequisitionRow | null = null;
    await this.workflow.act({
      tenantId: actor.tenantId,
      entityType: 'JOB_REQUISITION',
      entityId: id,
      actor,
      decision: 'REJECT',
      note,
      onFinal: async (tx) => {
        updated = await tx.jobRequisition.update({
          where: { id },
          data: { status: 'REJECTED', decidedAt: new Date(), decisionNote: note ?? null },
          include: requisitionInclude,
        });
      },
    });

    if (!updated) {
      return this.get(actor, id);
    }

    this.notifications
      .create({
        tenantId: actor.tenantId,
        userId: req.requestedById,
        type: NotificationType.REQUISITION_REJECTED,
        title: 'Job requisition rejected',
        message: `Your requisition for "${req.title}" has been rejected.${note ? ' Note: ' + note : ''}`,
        link: REQUISITIONS_LINK,
      })
      .catch(() => {});

    return this.toView(updated);
  }

  /** Null unless PENDING_APPROVAL. */
  async getWorkflowContext(tenantId: string, id: string): Promise<WorkflowEntityContext | null> {
    const req = await this.prisma.jobRequisition.findFirst({
      where: { id, tenantId, status: 'PENDING_APPROVAL' },
      select: {
        requesterEmployeeId: true,
        requestedById: true,
        submittedById: true,
        budgetMax: true,
        headcount: true,
      },
    });
    return req ? contextOf(req) : null;
  }

  /**
   * Consumed by WS-D2 on offer conversion: filledCount + 1, FILLED at headcount.
   * A no-op when the requisition no longer exists in the tenant.
   */
  async recordHire(tenantId: string, requisitionId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const req = await db.jobRequisition.findFirst({ where: { id: requisitionId, tenantId } });
    if (!req) return;

    const filledCount = req.filledCount + 1;
    await db.jobRequisition.update({
      where: { id: requisitionId },
      data: {
        filledCount,
        ...(filledCount >= req.headcount ? { status: 'FILLED' as JobRequisitionStatus } : {}),
      },
    });
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async findOwned(actor: AuthenticatedUser, id: string): Promise<RequisitionRow> {
    const req = await this.mustExist(actor.tenantId, id);
    if (!isHr(actor.role) && req.requestedById !== actor.userId) {
      throw new ForbiddenException('You cannot view this requisition');
    }
    return req;
  }

  private async mustExist(tenantId: string, id: string): Promise<RequisitionRow> {
    const req = await this.prisma.jobRequisition.findFirst({
      where: { id, tenantId },
      include: requisitionInclude,
    });
    if (!req) throw new NotFoundException('Job requisition not found');
    return req;
  }

  private async validateRefs(tenantId: string, input: Record<string, any>): Promise<void> {
    if (input.departmentId) {
      const dept = await this.prisma.department.findFirst({ where: { id: input.departmentId, tenantId } });
      if (!dept) throw new BadRequestException('Department not found in this tenant');
    }
    if (input.designationId) {
      const desig = await this.prisma.designation.findFirst({
        where: { id: input.designationId, tenantId },
      });
      if (!desig) throw new BadRequestException('Designation not found in this tenant');
    }
    if (input.hiringManagerId) {
      const manager = await this.prisma.employee.findFirst({
        where: { id: input.hiringManagerId, tenantId },
      });
      if (!manager) throw new BadRequestException('Hiring manager not found in this tenant');
    }
  }

  private async requestedByName(tenantId: string, userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { email: true, employee: { select: { firstName: true, lastName: true } } },
    });
    if (!user) return 'Unknown user';
    return user.employee ? `${user.employee.firstName} ${user.employee.lastName}`.trim() : user.email;
  }

  private async toView(req: RequisitionRow): Promise<RequisitionView> {
    return {
      id: req.id,
      title: req.title,
      department: req.department,
      designation: req.designation,
      hiringManager: req.hiringManager,
      headcount: req.headcount,
      filledCount: req.filledCount,
      employmentType: req.employmentType,
      budgetMin: req.budgetMin != null ? Number(req.budgetMin) : null,
      budgetMax: req.budgetMax != null ? Number(req.budgetMax) : null,
      justification: req.justification,
      status: req.status,
      requestedBy: {
        userId: req.requestedById,
        name: await this.requestedByName(req.tenantId, req.requestedById),
      },
      submittedAt: req.submittedAt?.toISOString() ?? null,
      decidedAt: req.decidedAt?.toISOString() ?? null,
      decisionNote: req.decisionNote,
      openingsCount: req._count.openings,
      createdAt: req.createdAt.toISOString(),
    };
  }
}
