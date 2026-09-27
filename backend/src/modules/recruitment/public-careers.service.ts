import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { CandidatesService } from './candidates.service';
import { ApplicationsService } from './applications.service';
import { assertResume } from './upload-guards';
import { PublicCareersView, PublicJobView } from './recruitment.types';

const CAREERS_NOT_FOUND = 'Careers page not found';

/**
 * Public careers page per tenant (by Tenant.code) and public apply.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part D3.
 *
 * Unknown tenant code, inactive tenant, and a tenant with the careers page
 * disabled all answer the identical 404 — nothing here lets a caller tell
 * those three apart.
 */
@Injectable()
export class PublicCareersService {
  private readonly logger = new Logger(PublicCareersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
    private readonly candidates: CandidatesService,
    private readonly applications: ApplicationsService,
  ) {}

  private async resolveTenant(tenantCode: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { code: { equals: tenantCode, mode: 'insensitive' } },
    });
    if (!tenant || !tenant.isActive) throw new NotFoundException(CAREERS_NOT_FOUND);

    const settings = await this.prisma.recruitmentSettings.findUnique({
      where: { tenantId: tenant.id },
    });
    if (!settings?.careersPageEnabled) throw new NotFoundException(CAREERS_NOT_FOUND);

    return { tenant, settings };
  }

  async getCareers(tenantCode: string): Promise<PublicCareersView> {
    const { tenant, settings } = await this.resolveTenant(tenantCode);

    const openings = await this.prisma.jobOpening.findMany({
      where: { tenantId: tenant.id, status: 'OPEN', isPublic: true },
      include: { department: true },
      orderBy: { publishedAt: 'desc' },
    });

    return {
      company: {
        name: tenant.name,
        logoUrl: tenant.logoUrl ?? null,
        website: tenant.website ?? null,
        description: tenant.description ?? null,
        careersIntro: settings.careersIntro ?? null,
      },
      jobs: openings.map((o) => ({
        slug: o.slug,
        title: o.title,
        location: o.location ?? null,
        department: o.department?.name ?? null,
        employmentType: o.employmentType,
        experienceMin: o.experienceMin ?? null,
        experienceMax: o.experienceMax ?? null,
        publishedAt: o.publishedAt ? o.publishedAt.toISOString() : null,
      })),
    };
  }

  async getJob(tenantCode: string, slug: string): Promise<PublicJobView> {
    const { tenant } = await this.resolveTenant(tenantCode);

    const opening = await this.prisma.jobOpening.findFirst({
      where: { tenantId: tenant.id, slug, status: 'OPEN', isPublic: true },
      include: { department: true },
    });
    if (!opening) throw new NotFoundException(CAREERS_NOT_FOUND);

    return {
      slug: opening.slug,
      title: opening.title,
      location: opening.location ?? null,
      department: opening.department?.name ?? null,
      employmentType: opening.employmentType,
      experienceMin: opening.experienceMin ?? null,
      experienceMax: opening.experienceMax ?? null,
      publishedAt: opening.publishedAt ? opening.publishedAt.toISOString() : null,
      description: opening.description,
      requirements: opening.requirements ?? null,
      salaryMin: opening.showSalary ? this.toNumber(opening.salaryMin) : null,
      salaryMax: opening.showSalary ? this.toNumber(opening.salaryMax) : null,
      company: { name: tenant.name, logoUrl: tenant.logoUrl ?? null },
    };
  }

  /**
   * Always resolves with the same 201 body, whether the application is new
   * or the candidate had already applied to this opening — so the response
   * itself never reveals whether a given email already exists.
   */
  async apply(
    tenantCode: string,
    slug: string,
    input: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      currentCompany?: string;
      currentTitle?: string;
      totalExperienceYears?: number;
      linkedinUrl?: string;
      coverLetter?: string;
      website?: string;
    },
    resume: Express.Multer.File,
  ): Promise<{ message: string }> {
    // Honeypot: a real applicant never fills a field hidden from them.
    if (input.website) throw new NotFoundException(CAREERS_NOT_FOUND);

    const { tenant } = await this.resolveTenant(tenantCode);

    const opening = await this.prisma.jobOpening.findFirst({
      where: { tenantId: tenant.id, slug, status: 'OPEN', isPublic: true },
    });
    if (!opening) throw new NotFoundException(CAREERS_NOT_FOUND);

    assertResume(resume);

    const { candidateId } = await this.candidates.findOrCreateForCareers({
      tenantId: tenant.id,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? null,
      currentCompany: input.currentCompany ?? null,
      currentTitle: input.currentTitle ?? null,
      totalExperienceYears: input.totalExperienceYears ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
    });

    const upload = await this.uploads.upload(resume, tenant.id, 'public:careers', 'CANDIDATE_RESUME', candidateId);

    // Only fills the candidate's resume when it has none yet — never
    // overwrites a resume already on file from an earlier application.
    await this.prisma.candidate.updateMany({
      where: { id: candidateId, tenantId: tenant.id, resumeUploadId: null },
      data: { resumeUploadId: upload.id },
    });

    const result = await this.applications.createFromCareers({
      tenantId: tenant.id,
      jobOpeningId: opening.id,
      candidateId,
      resumeUploadId: upload.id,
      coverLetter: input.coverLetter ?? null,
    });

    if (result.created) {
      this.notifications
        .notifyByRole(
          tenant.id,
          ['HR_ADMIN', 'SUPER_ADMIN'],
          NotificationType.APPLICATION_RECEIVED,
          'New application received',
          `${input.firstName} ${input.lastName} applied for ${opening.title}`,
          `/recruitment/openings/${opening.id}`,
        )
        .catch((error) => this.logger.warn(`APPLICATION_RECEIVED notification failed: ${error}`));
    }

    return { message: 'Application received' };
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'object' && 'toNumber' in (value as any) ? (value as any).toNumber() : Number(value);
  }
}
