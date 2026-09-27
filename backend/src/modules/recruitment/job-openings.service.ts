import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JobOpeningStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApplicationCardView, JobOpeningView } from './recruitment.types';

const MAX_SLUG_LENGTH = 80;

const openingInclude = {
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  hiringManager: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
} satisfies Prisma.JobOpeningInclude;

type OpeningRow = Prisma.JobOpeningGetPayload<{ include: typeof openingInclude }>;

function isHr(role: UserRole): boolean {
  return role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (base || 'opening').slice(0, MAX_SLUG_LENGTH);
}

/**
 * Job openings (slug per tenant, publish / hold / close).
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, D1.
 */
@Injectable()
export class JobOpeningsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedUser, query: { status?: string }): Promise<JobOpeningView[]> {
    const where: Prisma.JobOpeningWhereInput = { tenantId: actor.tenantId };
    if (query.status) where.status = query.status as JobOpeningStatus;
    if (!isHr(actor.role)) {
      if (!actor.employeeId) return [];
      where.hiringManagerId = actor.employeeId;
    }

    const rows = await this.prisma.jobOpening.findMany({
      where,
      include: openingInclude,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.toView(r)));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<JobOpeningView> {
    const opening = await this.findScoped(actor, id);
    return this.toView(opening);
  }

  async create(actor: AuthenticatedUser, input: Record<string, any>): Promise<JobOpeningView> {
    this.assertHr(actor);
    await this.validateRefs(actor.tenantId, input);

    let requisitionHeadcount: { headcount: number } | null = null;
    if (input.requisitionId) {
      const requisition = await this.prisma.jobRequisition.findFirst({
        where: { id: input.requisitionId, tenantId: actor.tenantId },
        select: { status: true, headcount: true },
      });
      if (!requisition) throw new BadRequestException('Requisition not found in this tenant');
      if (requisition.status !== 'APPROVED') {
        throw new BadRequestException('Openings can only be created from an APPROVED requisition');
      }
      requisitionHeadcount = { headcount: requisition.headcount };

      const existingPositions = await this.prisma.jobOpening.aggregate({
        where: { requisitionId: input.requisitionId, status: { not: 'CLOSED' } },
        _sum: { positions: true },
      });
      const positions = input.positions ?? 1;
      const total = (existingPositions._sum.positions ?? 0) + positions;
      if (total > requisitionHeadcount.headcount) {
        throw new BadRequestException(
          `Opening positions (${total}) would exceed the requisition headcount (${requisitionHeadcount.headcount})`,
        );
      }
    }

    const slug = await this.uniqueSlug(actor.tenantId, input.title);

    const created = await this.prisma.jobOpening.create({
      data: {
        tenantId: actor.tenantId,
        requisitionId: input.requisitionId ?? null,
        title: input.title,
        slug,
        description: input.description,
        requirements: input.requirements ?? null,
        location: input.location ?? null,
        departmentId: input.departmentId ?? null,
        designationId: input.designationId ?? null,
        branchId: input.branchId ?? null,
        employmentType: input.employmentType ?? 'PERMANENT',
        experienceMin: input.experienceMin ?? null,
        experienceMax: input.experienceMax ?? null,
        salaryMin: input.salaryMin ?? null,
        salaryMax: input.salaryMax ?? null,
        showSalary: input.showSalary ?? false,
        isPublic: input.isPublic ?? true,
        positions: input.positions ?? 1,
        hiringManagerId: input.hiringManagerId ?? null,
        status: 'DRAFT',
        createdById: actor.userId,
      },
      include: openingInclude,
    });
    return this.toView(created);
  }

  async update(actor: AuthenticatedUser, id: string, input: Record<string, any>): Promise<JobOpeningView> {
    this.assertHr(actor);
    const opening = await this.mustExist(actor.tenantId, id);
    await this.validateRefs(actor.tenantId, input);

    if (input.requisitionId !== undefined && input.requisitionId !== opening.requisitionId) {
      // Re-validating a requisition switch on update is out of scope for this wave.
      throw new BadRequestException('The requisition of an opening cannot be changed');
    }
    if (input.positions !== undefined && opening.requisitionId) {
      const requisition = await this.prisma.jobRequisition.findFirst({
        where: { id: opening.requisitionId, tenantId: actor.tenantId },
        select: { headcount: true },
      });
      if (requisition) {
        const otherPositions = await this.prisma.jobOpening.aggregate({
          where: {
            requisitionId: opening.requisitionId,
            status: { not: 'CLOSED' },
            id: { not: id },
          },
          _sum: { positions: true },
        });
        const total = (otherPositions._sum.positions ?? 0) + input.positions;
        if (total > requisition.headcount) {
          throw new BadRequestException(
            `Opening positions (${total}) would exceed the requisition headcount (${requisition.headcount})`,
          );
        }
      }
    }

    const updated = await this.prisma.jobOpening.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.requirements !== undefined ? { requirements: input.requirements } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.designationId !== undefined ? { designationId: input.designationId } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
        ...(input.experienceMin !== undefined ? { experienceMin: input.experienceMin } : {}),
        ...(input.experienceMax !== undefined ? { experienceMax: input.experienceMax } : {}),
        ...(input.salaryMin !== undefined ? { salaryMin: input.salaryMin } : {}),
        ...(input.salaryMax !== undefined ? { salaryMax: input.salaryMax } : {}),
        ...(input.showSalary !== undefined ? { showSalary: input.showSalary } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.positions !== undefined ? { positions: input.positions } : {}),
        ...(input.hiringManagerId !== undefined ? { hiringManagerId: input.hiringManagerId } : {}),
      },
      include: openingInclude,
    });
    return this.toView(updated);
  }

  async publish(actor: AuthenticatedUser, id: string): Promise<JobOpeningView> {
    this.assertHr(actor);
    const opening = await this.mustExist(actor.tenantId, id);
    if (opening.status !== 'DRAFT' && opening.status !== 'ON_HOLD') {
      throw new BadRequestException('Only a DRAFT or ON_HOLD opening can be published');
    }
    const updated = await this.prisma.jobOpening.update({
      where: { id },
      data: { status: 'OPEN', publishedAt: opening.publishedAt ?? new Date() },
      include: openingInclude,
    });
    return this.toView(updated);
  }

  async hold(actor: AuthenticatedUser, id: string): Promise<JobOpeningView> {
    this.assertHr(actor);
    const opening = await this.mustExist(actor.tenantId, id);
    if (opening.status !== 'OPEN') {
      throw new BadRequestException('Only an OPEN opening can be put on hold');
    }
    const updated = await this.prisma.jobOpening.update({
      where: { id },
      data: { status: 'ON_HOLD' },
      include: openingInclude,
    });
    return this.toView(updated);
  }

  async close(actor: AuthenticatedUser, id: string): Promise<JobOpeningView> {
    this.assertHr(actor);
    const opening = await this.mustExist(actor.tenantId, id);
    if (opening.status === 'CLOSED') {
      throw new BadRequestException('This opening is already closed');
    }
    const updated = await this.prisma.jobOpening.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
      include: openingInclude,
    });
    return this.toView(updated);
  }

  async listApplications(actor: AuthenticatedUser, id: string): Promise<ApplicationCardView[]> {
    const opening = await this.findScoped(actor, id);
    const applications = await this.prisma.jobApplication.findMany({
      where: { tenantId: actor.tenantId, jobOpeningId: opening.id },
      include: {
        candidate: { select: { id: true, firstName: true, lastName: true, email: true, currentTitle: true } },
        stage: true,
        _count: { select: { interviews: true } },
      },
      orderBy: { appliedAt: 'desc' },
    });

    return applications.map((a) => ({
      id: a.id,
      candidate: a.candidate,
      stage: {
        id: a.stage.id,
        name: a.stage.name,
        sortOrder: a.stage.sortOrder,
        category: a.stage.category,
        isActive: a.stage.isActive,
      },
      status: a.status,
      source: a.source,
      appliedAt: a.appliedAt.toISOString(),
      stageChangedAt: a.stageChangedAt.toISOString(),
      interviewCount: a._count.interviews,
    }));
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private assertHr(actor: AuthenticatedUser): void {
    if (!isHr(actor.role)) {
      throw new ForbiddenException('Only HR can perform this action');
    }
  }

  private async findScoped(actor: AuthenticatedUser, id: string): Promise<OpeningRow> {
    const opening = await this.mustExist(actor.tenantId, id);
    if (!isHr(actor.role) && opening.hiringManagerId !== actor.employeeId) {
      throw new ForbiddenException('You cannot view this opening');
    }
    return opening;
  }

  private async mustExist(tenantId: string, id: string): Promise<OpeningRow> {
    const opening = await this.prisma.jobOpening.findFirst({
      where: { id, tenantId },
      include: openingInclude,
    });
    if (!opening) throw new NotFoundException('Job opening not found');
    return opening;
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
    if (input.branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: input.branchId, tenantId } });
      if (!branch) throw new BadRequestException('Branch not found in this tenant');
    }
    if (input.hiringManagerId) {
      const manager = await this.prisma.employee.findFirst({
        where: { id: input.hiringManagerId, tenantId },
      });
      if (!manager) throw new BadRequestException('Hiring manager not found in this tenant');
    }
  }

  private async uniqueSlug(tenantId: string, title: string): Promise<string> {
    const base = slugify(title);
    let candidate = base;
    let suffix = 2;
    for (;;) {
      const existing = await this.prisma.jobOpening.findUnique({
        where: { tenantId_slug: { tenantId, slug: candidate } },
      });
      if (!existing) return candidate;
      candidate = `${base}-${suffix}`.slice(0, MAX_SLUG_LENGTH);
      suffix += 1;
    }
  }

  private async toView(opening: OpeningRow): Promise<JobOpeningView> {
    const stages = await this.prisma.jobApplication.groupBy({
      by: ['stageId'],
      where: { tenantId: opening.tenantId, jobOpeningId: opening.id, status: 'ACTIVE' },
      _count: { _all: true },
    });
    const applicationCounts: Record<string, number> = {};
    for (const s of stages) applicationCounts[s.stageId] = s._count._all;

    return {
      id: opening.id,
      requisitionId: opening.requisitionId,
      title: opening.title,
      slug: opening.slug,
      description: opening.description,
      requirements: opening.requirements,
      location: opening.location,
      department: opening.department,
      designation: opening.designation,
      branch: opening.branch,
      employmentType: opening.employmentType,
      experienceMin: opening.experienceMin,
      experienceMax: opening.experienceMax,
      salaryMin: opening.salaryMin != null ? Number(opening.salaryMin) : null,
      salaryMax: opening.salaryMax != null ? Number(opening.salaryMax) : null,
      showSalary: opening.showSalary,
      isPublic: opening.isPublic,
      positions: opening.positions,
      hiringManager: opening.hiringManager,
      status: opening.status,
      publishedAt: opening.publishedAt?.toISOString() ?? null,
      closedAt: opening.closedAt?.toISOString() ?? null,
      applicationCounts,
      createdAt: opening.createdAt.toISOString(),
    };
  }
}
