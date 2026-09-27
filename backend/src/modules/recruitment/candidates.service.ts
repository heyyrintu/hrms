import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Candidate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  CandidateDetailView,
  CandidateView,
  CareersCandidateInput,
  PipelineStageView,
} from './recruitment.types';

type CandidateRow = Candidate & {
  referredBy: { id: string; employeeCode: string; firstName: string; lastName: string } | null;
  resumeUpload: { key: string; fileName: string } | null;
};

const candidateInclude = {
  referredBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
  resumeUpload: { select: { key: true, fileName: true } },
} as const;

/**
 * Candidates, deduplicated by email per tenant.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, D1.
 */
@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedUser, query: { search?: string }): Promise<CandidateView[]> {
    const search = query.search?.trim();
    const rows = await this.prisma.candidate.findMany({
      where: {
        tenantId: actor.tenantId,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: candidateInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<CandidateDetailView> {
    const candidate = await this.findOrFail(actor.tenantId, id);
    const applications = await this.prisma.jobApplication.findMany({
      where: { tenantId: actor.tenantId, candidateId: id },
      include: {
        jobOpening: { select: { id: true, title: true } },
        stage: true,
      },
      orderBy: { appliedAt: 'desc' },
    });
    return {
      ...this.toView(candidate),
      applications: applications.map((a) => ({
        id: a.id,
        jobOpening: a.jobOpening,
        stage: this.stageView(a.stage),
        status: a.status,
        appliedAt: a.appliedAt.toISOString(),
      })),
    };
  }

  async create(actor: AuthenticatedUser, input: Record<string, any>): Promise<CandidateView> {
    const email = String(input.email).trim().toLowerCase();
    const existing = await this.prisma.candidate.findUnique({
      where: { tenantId_email: { tenantId: actor.tenantId, email } },
    });
    if (existing) {
      throw new ConflictException({
        message: 'A candidate with this email already exists',
        existingCandidateId: existing.id,
      });
    }

    if (input.referredByEmployeeId) {
      await this.assertEmployeeInTenant(actor.tenantId, input.referredByEmployeeId);
    }
    if (input.resumeUploadId) {
      await this.assertUploadInTenant(actor.tenantId, input.resumeUploadId);
    }

    const created = await this.prisma.candidate.create({
      data: {
        tenantId: actor.tenantId,
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone: input.phone ?? null,
        currentCompany: input.currentCompany ?? null,
        currentTitle: input.currentTitle ?? null,
        totalExperienceYears: input.totalExperienceYears ?? null,
        currentCtc: input.currentCtc ?? null,
        expectedCtc: input.expectedCtc ?? null,
        noticePeriodDays: input.noticePeriodDays ?? null,
        location: input.location ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        source: input.source ?? 'DIRECT',
        referredByEmployeeId: input.referredByEmployeeId ?? null,
        resumeUploadId: input.resumeUploadId ?? null,
        notes: input.notes ?? null,
        createdById: actor.userId,
      },
      include: candidateInclude,
    });
    return this.toView(created);
  }

  async update(actor: AuthenticatedUser, id: string, input: Record<string, any>): Promise<CandidateView> {
    await this.findOrFail(actor.tenantId, id);

    if (input.email) {
      const email = String(input.email).trim().toLowerCase();
      const existing = await this.prisma.candidate.findUnique({
        where: { tenantId_email: { tenantId: actor.tenantId, email } },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException({
          message: 'A candidate with this email already exists',
          existingCandidateId: existing.id,
        });
      }
      input.email = email;
    }
    if (input.referredByEmployeeId) {
      await this.assertEmployeeInTenant(actor.tenantId, input.referredByEmployeeId);
    }
    if (input.resumeUploadId) {
      await this.assertUploadInTenant(actor.tenantId, input.resumeUploadId);
    }

    const updated = await this.prisma.candidate.update({
      where: { id },
      data: { ...input },
      include: candidateInclude,
    });
    return this.toView(updated);
  }

  /**
   * Consumed by WS-D3 (public apply): reuse the candidate by email, filling
   * only fields that are currently empty — data supplied by HR is never
   * overwritten from an unauthenticated source.
   */
  async findOrCreateForCareers(
    input: CareersCandidateInput,
  ): Promise<{ candidateId: string; created: boolean }> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.candidate.findUnique({
      where: { tenantId_email: { tenantId: input.tenantId, email } },
    });

    if (!existing) {
      const created = await this.prisma.candidate.create({
        data: {
          tenantId: input.tenantId,
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          phone: input.phone ?? null,
          currentCompany: input.currentCompany ?? null,
          currentTitle: input.currentTitle ?? null,
          totalExperienceYears: input.totalExperienceYears ?? null,
          linkedinUrl: input.linkedinUrl ?? null,
          source: 'CAREERS_PAGE',
          resumeUploadId: input.resumeUploadId ?? null,
        },
      });
      return { candidateId: created.id, created: true };
    }

    const fill: Record<string, unknown> = {};
    if (!existing.phone && input.phone) fill.phone = input.phone;
    if (!existing.currentCompany && input.currentCompany) fill.currentCompany = input.currentCompany;
    if (!existing.currentTitle && input.currentTitle) fill.currentTitle = input.currentTitle;
    if (existing.totalExperienceYears == null && input.totalExperienceYears != null) {
      fill.totalExperienceYears = input.totalExperienceYears;
    }
    if (!existing.linkedinUrl && input.linkedinUrl) fill.linkedinUrl = input.linkedinUrl;
    if (!existing.resumeUploadId && input.resumeUploadId) fill.resumeUploadId = input.resumeUploadId;

    if (Object.keys(fill).length > 0) {
      await this.prisma.candidate.update({ where: { id: existing.id }, data: fill });
    }
    return { candidateId: existing.id, created: false };
  }

  private async findOrFail(tenantId: string, id: string): Promise<CandidateRow> {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, tenantId },
      include: candidateInclude,
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    return candidate as CandidateRow;
  }

  private async assertEmployeeInTenant(tenantId: string, employeeId: string): Promise<void> {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
    if (!employee) throw new BadRequestException('Referring employee not found in this tenant');
  }

  private async assertUploadInTenant(tenantId: string, uploadId: string): Promise<void> {
    const upload = await this.prisma.upload.findFirst({ where: { id: uploadId, tenantId } });
    if (!upload) throw new BadRequestException('Resume upload not found in this tenant');
  }

  private stageView(stage: {
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

  private toView(candidate: CandidateRow): CandidateView {
    return {
      id: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
      currentCompany: candidate.currentCompany,
      currentTitle: candidate.currentTitle,
      totalExperienceYears: candidate.totalExperienceYears ? Number(candidate.totalExperienceYears) : null,
      currentCtc: candidate.currentCtc != null ? Number(candidate.currentCtc) : null,
      expectedCtc: candidate.expectedCtc != null ? Number(candidate.expectedCtc) : null,
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
}
