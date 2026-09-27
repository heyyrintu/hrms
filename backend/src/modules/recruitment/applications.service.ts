import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PipelineStagesService } from './pipeline-stages.service';
import {
  ApplicationDetailView,
  CareersApplicationInput,
  CareersApplicationResult,
  CandidateView,
  MoveApplicationInput,
  PipelineStageView,
  StageEventView,
} from './recruitment.types';

const P2002 = 'P2002';

const applicationDetailInclude = {
  candidate: {
    include: {
      referredBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      resumeUpload: { select: { key: true, fileName: true } },
    },
  },
  jobOpening: { select: { id: true, title: true, hiringManagerId: true, requisitionId: true } },
  stage: true,
  resumeUpload: { select: { key: true, fileName: true } },
  stageEvents: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      fromStage: { select: { id: true, name: true } },
      toStage: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.JobApplicationInclude;

type ApplicationRow = Prisma.JobApplicationGetPayload<{ include: typeof applicationDetailInclude }>;

function isHr(role: UserRole): boolean {
  return role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
}

function stageView(stage: {
  id: string;
  name: string;
  sortOrder: number;
  category: string;
  isActive: boolean;
}): PipelineStageView {
  return {
    id: stage.id,
    name: stage.name,
    sortOrder: stage.sortOrder,
    category: stage.category as PipelineStageView['category'],
    isActive: stage.isActive,
  };
}

/**
 * Applications and stage moves (with JobApplicationStageEvent history).
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, D1.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stages: PipelineStagesService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: { candidateId: string; jobOpeningId: string; source?: string },
  ): Promise<ApplicationDetailView> {
    if (!isHr(actor.role)) {
      throw new ForbiddenException('Only HR can add an application for a candidate');
    }

    const candidate = await this.prisma.candidate.findFirst({
      where: { id: input.candidateId, tenantId: actor.tenantId },
    });
    if (!candidate) throw new BadRequestException('Candidate not found in this tenant');

    const opening = await this.prisma.jobOpening.findFirst({
      where: { id: input.jobOpeningId, tenantId: actor.tenantId },
    });
    if (!opening) throw new BadRequestException('Job opening not found in this tenant');

    await this.stages.ensureDefaults(actor.tenantId);
    const firstStage = await this.prisma.pipelineStage.findFirst({
      where: { tenantId: actor.tenantId, category: 'APPLIED', isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (!firstStage) throw new BadRequestException('No active APPLIED stage is configured');

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const app = await tx.jobApplication.create({
          data: {
            tenantId: actor.tenantId,
            candidateId: input.candidateId,
            jobOpeningId: input.jobOpeningId,
            stageId: firstStage.id,
            status: 'ACTIVE',
            source: (input.source as any) ?? candidate.source,
            createdById: actor.userId,
          },
        });
        await tx.jobApplicationStageEvent.create({
          data: {
            tenantId: actor.tenantId,
            applicationId: app.id,
            fromStageId: null,
            toStageId: firstStage.id,
            movedById: actor.userId,
          },
        });
        return app;
      });
      return this.get(actor, created.id);
    } catch (error) {
      if ((error as { code?: string }).code === P2002) {
        throw new ConflictException('This candidate has already applied to this opening');
      }
      throw error;
    }
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ApplicationDetailView> {
    const app = await this.findScoped(actor, id);
    return this.toView(app, isHr(actor.role));
  }

  async move(
    actor: AuthenticatedUser,
    id: string,
    input: { stageId: string; note?: string | null },
  ): Promise<ApplicationDetailView> {
    await this.findScoped(actor, id);
    await this.moveToStage({
      tenantId: actor.tenantId,
      applicationId: id,
      toStageId: input.stageId,
      actorUserId: actor.userId,
      note: input.note ?? null,
    });
    return this.get(actor, id);
  }

  async reject(actor: AuthenticatedUser, id: string, reason: string): Promise<ApplicationDetailView> {
    await this.findScoped(actor, id);
    await this.moveToStage({
      tenantId: actor.tenantId,
      applicationId: id,
      toCategory: 'REJECTED',
      actorUserId: actor.userId,
      rejectionReason: reason,
    });
    return this.get(actor, id);
  }

  async withdraw(actor: AuthenticatedUser, id: string): Promise<ApplicationDetailView> {
    if (!isHr(actor.role)) {
      throw new ForbiddenException('Only HR can withdraw an application');
    }
    const app = await this.findScoped(actor, id);
    if (app.status !== 'ACTIVE') {
      throw new BadRequestException('Only an active application can be withdrawn');
    }
    await this.prisma.jobApplication.update({ where: { id }, data: { status: 'WITHDRAWN' } });
    return this.get(actor, id);
  }

  /** Shared contract, consumed by WS-D2. Accepts a transaction client. */
  async moveToStage(input: MoveApplicationInput): Promise<void> {
    const readDb = input.tx ?? this.prisma;

    const app = await readDb.jobApplication.findFirst({
      where: { id: input.applicationId, tenantId: input.tenantId },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'ACTIVE') {
      throw new BadRequestException('Only an active application can move stage');
    }

    await this.stages.ensureDefaults(input.tenantId);

    let targetStage;
    if (input.toStageId) {
      targetStage = await readDb.pipelineStage.findFirst({
        where: { id: input.toStageId, tenantId: input.tenantId, isActive: true },
      });
      if (!targetStage) throw new BadRequestException('Target stage not found or inactive');
    } else if (input.toCategory) {
      targetStage = await readDb.pipelineStage.findFirst({
        where: { tenantId: input.tenantId, category: input.toCategory, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      if (!targetStage) {
        throw new BadRequestException(`No active stage of category ${input.toCategory} is configured`);
      }
    } else {
      throw new BadRequestException('toStageId or toCategory is required');
    }

    if (targetStage.category === 'REJECTED' && !input.rejectionReason) {
      throw new BadRequestException('A rejection reason is required to reject an application');
    }

    const statusUpdate: Record<string, unknown> = {};
    if (targetStage.category === 'REJECTED') {
      statusUpdate.status = 'REJECTED';
      statusUpdate.rejectionReason = input.rejectionReason;
    } else if (targetStage.category === 'HIRED') {
      statusUpdate.status = 'HIRED';
      statusUpdate.hiredAt = new Date();
    }

    const run = async (tx: Prisma.TransactionClient | typeof this.prisma) => {
      await tx.jobApplication.update({
        where: { id: app.id },
        data: { stageId: targetStage.id, stageChangedAt: new Date(), ...statusUpdate },
      });
      await tx.jobApplicationStageEvent.create({
        data: {
          tenantId: input.tenantId,
          applicationId: app.id,
          fromStageId: app.stageId,
          toStageId: targetStage.id,
          movedById: input.actorUserId,
          note: input.note ?? null,
        },
      });
    };

    if (input.tx) {
      await run(input.tx);
    } else {
      await this.prisma.$transaction((tx) => run(tx));
    }
  }

  /** Consumed by WS-D3 (public apply). Duplicate → { created: false }. */
  async createFromCareers(input: CareersApplicationInput): Promise<CareersApplicationResult> {
    const existing = await this.prisma.jobApplication.findUnique({
      where: { jobOpeningId_candidateId: { jobOpeningId: input.jobOpeningId, candidateId: input.candidateId } },
    });
    if (existing) return { created: false, applicationId: existing.id };

    await this.stages.ensureDefaults(input.tenantId);
    const firstStage = await this.prisma.pipelineStage.findFirst({
      where: { tenantId: input.tenantId, category: 'APPLIED', isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (!firstStage) throw new BadRequestException('No active APPLIED stage is configured');

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const app = await tx.jobApplication.create({
          data: {
            tenantId: input.tenantId,
            candidateId: input.candidateId,
            jobOpeningId: input.jobOpeningId,
            stageId: firstStage.id,
            status: 'ACTIVE',
            source: 'CAREERS_PAGE',
            resumeUploadId: input.resumeUploadId,
            coverLetter: input.coverLetter ?? null,
            createdById: null,
          },
        });
        await tx.jobApplicationStageEvent.create({
          data: {
            tenantId: input.tenantId,
            applicationId: app.id,
            fromStageId: null,
            toStageId: firstStage.id,
            movedById: null,
          },
        });
        return app;
      });
      return { created: true, applicationId: created.id };
    } catch (error) {
      if ((error as { code?: string }).code === P2002) {
        const dup = await this.prisma.jobApplication.findUnique({
          where: {
            jobOpeningId_candidateId: { jobOpeningId: input.jobOpeningId, candidateId: input.candidateId },
          },
        });
        if (dup) return { created: false, applicationId: dup.id };
      }
      throw error;
    }
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async findScoped(actor: AuthenticatedUser, id: string): Promise<ApplicationRow> {
    const app = await this.prisma.jobApplication.findFirst({
      where: { id, tenantId: actor.tenantId },
      include: applicationDetailInclude,
    });
    if (!app) throw new NotFoundException('Application not found');
    if (!isHr(actor.role) && app.jobOpening.hiringManagerId !== actor.employeeId) {
      throw new ForbiddenException('You cannot access this application');
    }
    return app;
  }

  private toCandidateView(candidate: ApplicationRow['candidate'], hrVisible: boolean): CandidateView {
    return {
      id: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
      currentCompany: candidate.currentCompany,
      currentTitle: candidate.currentTitle,
      totalExperienceYears:
        candidate.totalExperienceYears != null ? Number(candidate.totalExperienceYears) : null,
      currentCtc: hrVisible && candidate.currentCtc != null ? Number(candidate.currentCtc) : null,
      expectedCtc: hrVisible && candidate.expectedCtc != null ? Number(candidate.expectedCtc) : null,
      noticePeriodDays: candidate.noticePeriodDays,
      location: candidate.location,
      linkedinUrl: candidate.linkedinUrl,
      source: candidate.source,
      referredBy: candidate.referredBy,
      resumeKey: candidate.resumeUpload?.key ?? null,
      resumeFileName: candidate.resumeUpload?.fileName ?? null,
      notes: candidate.notes,
      createdAt: candidate.createdAt.toISOString(),
    };
  }

  private toStageEventView(event: ApplicationRow['stageEvents'][number], names: Map<string, string>): StageEventView {
    return {
      id: event.id,
      fromStage: event.fromStage,
      toStage: event.toStage,
      movedBy: event.movedById
        ? { userId: event.movedById, name: names.get(event.movedById) ?? 'Unknown user' }
        : null,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private async toView(app: ApplicationRow, hrVisible: boolean): Promise<ApplicationDetailView> {
    const movedByIds = [...new Set(app.stageEvents.map((e) => e.movedById).filter((id): id is string => !!id))];
    const users = movedByIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId: app.tenantId, id: { in: movedByIds } },
          select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const names = new Map(
      users.map((u) => [
        u.id,
        u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
      ]),
    );

    return {
      id: app.id,
      candidate: this.toCandidateView(app.candidate, hrVisible),
      jobOpening: app.jobOpening,
      stage: stageView(app.stage),
      status: app.status,
      source: app.source,
      resumeKey: app.resumeUpload?.key ?? null,
      resumeFileName: app.resumeUpload?.fileName ?? null,
      coverLetter: app.coverLetter,
      rejectionReason: app.rejectionReason,
      appliedAt: app.appliedAt.toISOString(),
      stageChangedAt: app.stageChangedAt.toISOString(),
      hiredAt: app.hiredAt?.toISOString() ?? null,
      history: app.stageEvents.map((e) => this.toStageEventView(e, names)),
    };
  }
}
