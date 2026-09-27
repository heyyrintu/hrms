import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { EmailService } from '../../common/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { generatePublicToken, hashPublicToken, isWellFormedPublicToken } from './public-token.util';
import { assertDocument } from './upload-guards';
import {
  DEFAULT_PRE_ONBOARDING_DOCUMENTS,
  PreOnboardingDocumentDefinition,
  PreOnboardingDocumentState,
  PreOnboardingInviteCreated,
  PreOnboardingInviteView,
  PreOnboardingPersonalDetails,
  PublicPreOnboardingView,
} from './recruitment.types';

const LINK_INVALID_MESSAGE = 'This pre-onboarding link is invalid or has expired';
const LOCKED_MESSAGE = 'This pre-onboarding submission is locked. Ask HR to resend the invite to make further changes.';

const LIVE_STATUSES = ['INVITED', 'IN_PROGRESS', 'SUBMITTED'] as const;
// COMPLETED is terminal for the public link too: once HR has closed the
// checklist the token must stop serving the joiner's personal details.
// HR views (by id) are unaffected.
const TERMINAL_STATUSES = ['REVOKED', 'EXPIRED', 'COMPLETED'] as const;
const LOCKED_STATUSES = ['SUBMITTED', 'COMPLETED', 'REVOKED', 'EXPIRED'] as const;

type InviteRow = Prisma.PreOnboardingInviteGetPayload<{
  include: {
    employee: true;
    tenant: true;
    documents: { include: { employeeDocument: { include: { upload: true } } } };
  };
}>;

/**
 * Pre-onboarding invites (HR side) and the public token portal.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part D3.
 */
@Injectable()
export class PreOnboardingService {
  private readonly logger = new Logger(PreOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
  ) {}

  // ---- HR side ---------------------------------------------------------

  async create(
    actor: AuthenticatedUser,
    input: { employeeId: string; offerId?: string; requiredDocuments?: PreOnboardingDocumentDefinition[]; expiresInDays?: number },
  ): Promise<PreOnboardingInviteCreated> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, tenantId: actor.tenantId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const live = await this.prisma.preOnboardingInvite.findFirst({
      where: { employeeId: employee.id, tenantId: actor.tenantId, status: { in: [...LIVE_STATUSES] } },
    });
    if (live) throw new ConflictException('This employee already has a live pre-onboarding invite');

    if (input.offerId) {
      const offer = await this.prisma.jobOffer.findFirst({
        where: { id: input.offerId, tenantId: actor.tenantId },
        select: { id: true, employeeId: true, preOnboarding: { select: { id: true } } },
      });
      if (!offer) throw new BadRequestException('Offer not found in this tenant');
      if (offer.employeeId && offer.employeeId !== employee.id) {
        throw new BadRequestException('The offer belongs to a different employee');
      }
      if (offer.preOnboarding) {
        throw new ConflictException('This offer already has a pre-onboarding invite');
      }
    }

    const settings = await this.prisma.recruitmentSettings.findUnique({ where: { tenantId: actor.tenantId } });
    const tenantDocuments = settings?.preOnboardingDocuments as unknown as PreOnboardingDocumentDefinition[] | undefined;
    const requiredDocuments =
      input.requiredDocuments ?? (tenantDocuments?.length ? tenantDocuments : [...DEFAULT_PRE_ONBOARDING_DOCUMENTS]);
    const expiresInDays = input.expiresInDays ?? settings?.preOnboardingExpiryDays ?? 14;

    const token = generatePublicToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.preOnboardingInvite.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: employee.id,
        offerId: input.offerId ?? null,
        tokenHash: token.hash,
        expiresAt,
        status: 'INVITED',
        requiredDocuments: requiredDocuments as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
      },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
    });

    const link = this.buildLink(token.raw);
    await this.sendInviteEmail(invite, link);

    return { invite: this.toInviteView(invite), link };
  }

  async list(tenantId: string, status?: string): Promise<PreOnboardingInviteView[]> {
    const invites = await this.prisma.preOnboardingInvite.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((invite) => this.toInviteView(invite));
  }

  async get(tenantId: string, id: string): Promise<PreOnboardingInviteView> {
    const invite = await this.findByIdOrThrow(tenantId, id);
    return this.toInviteView(invite);
  }

  async revoke(actor: AuthenticatedUser, id: string): Promise<PreOnboardingInviteView> {
    const invite = await this.findByIdOrThrow(actor.tenantId, id);
    if (!(LIVE_STATUSES as readonly string[]).includes(invite.status)) {
      throw new BadRequestException('Only a live invite can be revoked');
    }
    const updated = await this.prisma.preOnboardingInvite.update({
      where: { id: invite.id },
      data: { status: 'REVOKED' },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
    });
    return this.toInviteView(updated);
  }

  async resend(actor: AuthenticatedUser, id: string): Promise<PreOnboardingInviteCreated> {
    const invite = await this.findByIdOrThrow(actor.tenantId, id);
    if (!(LIVE_STATUSES as readonly string[]).includes(invite.status)) {
      throw new BadRequestException('Only a live invite can be resent');
    }

    const settings = await this.prisma.recruitmentSettings.findUnique({ where: { tenantId: actor.tenantId } });
    const expiresInDays = settings?.preOnboardingExpiryDays ?? 14;
    const token = generatePublicToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const updated = await this.prisma.preOnboardingInvite.update({
      where: { id: invite.id },
      data: { tokenHash: token.hash, expiresAt, status: 'INVITED' },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
    });

    const link = this.buildLink(token.raw);
    await this.sendInviteEmail(updated, link);

    return { invite: this.toInviteView(updated), link };
  }

  async complete(actor: AuthenticatedUser, id: string): Promise<PreOnboardingInviteView> {
    const invite = await this.findByIdOrThrow(actor.tenantId, id);
    if (invite.status !== 'SUBMITTED') {
      throw new BadRequestException('Only a submitted invite can be marked complete');
    }
    const updated = await this.prisma.preOnboardingInvite.update({
      where: { id: invite.id },
      data: { status: 'COMPLETED' },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
    });
    return this.toInviteView(updated);
  }

  // ---- Public portal ----------------------------------------------------

  async getPublic(rawToken: string): Promise<PublicPreOnboardingView> {
    const invite = await this.resolveByToken(rawToken);
    const updated = await this.prisma.preOnboardingInvite.update({
      where: { id: invite.id },
      data: { lastAccessedAt: new Date() },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
    });
    return this.toPublicView(updated);
  }

  async saveDetailsPublic(rawToken: string, details: PreOnboardingPersonalDetails): Promise<PublicPreOnboardingView> {
    const invite = await this.resolveByToken(rawToken);
    this.assertWritable(invite);

    const employeeData = this.buildEmployeeUpdate(details);
    const mergedDetails = { ...((invite.personalDetails as Record<string, unknown> | null) ?? {}), ...details };

    await this.prisma.$transaction([
      this.prisma.employee.update({ where: { id: invite.employeeId }, data: employeeData }),
      this.prisma.preOnboardingInvite.update({
        where: { id: invite.id },
        data: {
          personalDetails: mergedDetails as unknown as Prisma.InputJsonValue,
          status: invite.status === 'INVITED' ? 'IN_PROGRESS' : invite.status,
        },
      }),
    ]);

    const updated = await this.findByIdOrThrow(invite.tenantId, invite.id);
    return this.toPublicView(updated);
  }

  async uploadDocumentPublic(rawToken: string, documentKey: string, file: Express.Multer.File): Promise<PublicPreOnboardingView> {
    const invite = await this.resolveByToken(rawToken);
    this.assertWritable(invite);

    const requiredDocuments = invite.requiredDocuments as unknown as PreOnboardingDocumentDefinition[];
    const definition = requiredDocuments.find((d) => d.key === documentKey);
    if (!definition) throw new BadRequestException('Unknown document for this checklist');

    assertDocument(file);

    const existing = invite.documents.find((d) => d.documentKey === documentKey);

    const upload = await this.uploads.upload(file, invite.tenantId, 'public:pre-onboarding', 'PRE_ONBOARDING', invite.id);
    const employeeDocument = await this.prisma.employeeDocument.create({
      data: {
        tenantId: invite.tenantId,
        employeeId: invite.employeeId,
        uploadId: upload.id,
        name: definition.label,
        category: definition.category,
        isVerified: false,
      },
    });

    if (existing) {
      await this.prisma.preOnboardingDocument.update({
        where: { id: existing.id },
        data: { employeeDocumentId: employeeDocument.id, uploadedAt: new Date() },
      });
      // Replace semantics: the old file and its records are removed once the
      // new one is safely in place, never leaving the checklist without a document.
      await this.prisma.employeeDocument.delete({ where: { id: existing.employeeDocumentId } }).catch((error) => {
        this.logger.warn(`Failed to delete superseded EmployeeDocument ${existing.employeeDocumentId}: ${error}`);
      });
      await this.uploads.deleteByAdmin(existing.employeeDocument.upload.key, invite.tenantId).catch((error) => {
        this.logger.warn(`Failed to delete superseded upload ${existing.employeeDocument.upload.key}: ${error}`);
      });
    } else {
      await this.prisma.preOnboardingDocument.create({
        data: {
          tenantId: invite.tenantId,
          inviteId: invite.id,
          documentKey,
          employeeDocumentId: employeeDocument.id,
        },
      });
    }

    if (invite.status === 'INVITED') {
      await this.prisma.preOnboardingInvite.update({ where: { id: invite.id }, data: { status: 'IN_PROGRESS' } });
    }

    const updated = await this.findByIdOrThrow(invite.tenantId, invite.id);
    return this.toPublicView(updated);
  }

  async submitPublic(rawToken: string): Promise<PublicPreOnboardingView> {
    const invite = await this.resolveByToken(rawToken);
    this.assertWritable(invite);

    const requiredDocuments = invite.requiredDocuments as unknown as PreOnboardingDocumentDefinition[];
    const uploadedKeys = new Set(invite.documents.map((d) => d.documentKey));
    const missing = requiredDocuments.filter((d) => d.required && !uploadedKeys.has(d.key));
    if (missing.length > 0) {
      throw new BadRequestException(
        `All required documents must be uploaded before submitting: ${missing.map((d) => d.label).join(', ')}`,
      );
    }

    const updated = await this.prisma.preOnboardingInvite.update({
      where: { id: invite.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
    });

    this.notifications
      .notifyByRole(
        invite.tenantId,
        ['HR_ADMIN', 'SUPER_ADMIN'],
        NotificationType.PRE_ONBOARDING_SUBMITTED,
        'Pre-onboarding submitted',
        `${invite.employee.firstName} ${invite.employee.lastName} submitted their pre-onboarding details`,
        `/recruitment/pre-onboarding/${invite.id}`,
      )
      .catch((error) => this.logger.warn(`PRE_ONBOARDING_SUBMITTED notification failed: ${error}`));

    return this.toPublicView(updated);
  }

  // ---- Shared helpers -----------------------------------------------------

  private async findByIdOrThrow(tenantId: string, id: string): Promise<InviteRow> {
    const invite = await this.prisma.preOnboardingInvite.findFirst({
      where: { id, tenantId },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
    });
    if (!invite) throw new NotFoundException('Pre-onboarding invite not found');
    return invite;
  }

  /**
   * Looks an invite up by its raw public token, lazily marking it EXPIRED
   * once past `expiresAt`, and 404s (identical message) for an unknown,
   * malformed, revoked or expired token — never distinguishing which.
   */
  private async resolveByToken(rawToken: string): Promise<InviteRow> {
    if (!isWellFormedPublicToken(rawToken)) throw new NotFoundException(LINK_INVALID_MESSAGE);

    const tokenHash = hashPublicToken(rawToken);
    const invite = await this.prisma.preOnboardingInvite.findFirst({
      where: { tokenHash },
      include: { employee: true, tenant: true, documents: { include: { employeeDocument: { include: { upload: true } } } } },
    });
    if (!invite) throw new NotFoundException(LINK_INVALID_MESSAGE);

    if ((TERMINAL_STATUSES as readonly string[]).includes(invite.status)) {
      throw new NotFoundException(LINK_INVALID_MESSAGE);
    }

    if (invite.expiresAt.getTime() < Date.now()) {
      await this.prisma.preOnboardingInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
      throw new NotFoundException(LINK_INVALID_MESSAGE);
    }

    return invite;
  }

  private assertWritable(invite: InviteRow): void {
    if ((LOCKED_STATUSES as readonly string[]).includes(invite.status)) {
      throw new BadRequestException(LOCKED_MESSAGE);
    }
  }

  private buildEmployeeUpdate(details: PreOnboardingPersonalDetails): Prisma.EmployeeUpdateInput {
    const data: Prisma.EmployeeUpdateInput = {};
    const assignIfPresent = <K extends keyof PreOnboardingPersonalDetails>(key: K, mapped: (v: PreOnboardingPersonalDetails[K]) => unknown) => {
      if (Object.prototype.hasOwnProperty.call(details, key)) {
        (data as Record<string, unknown>)[key] = mapped(details[key]);
      }
    };

    assignIfPresent('dateOfBirth', (v) => (v ? new Date(`${v}T00:00:00.000Z`) : null));
    assignIfPresent('gender', (v) => v ?? null);
    assignIfPresent('maritalStatus', (v) => v ?? null);
    assignIfPresent('bloodGroup', (v) => v ?? null);
    assignIfPresent('fatherName', (v) => v ?? null);
    assignIfPresent('personalEmail', (v) => v ?? null);
    assignIfPresent('mobileNumber', (v) => v ?? null);
    assignIfPresent('currentAddress', (v) => v ?? null);
    assignIfPresent('currentCity', (v) => v ?? null);
    assignIfPresent('currentState', (v) => v ?? null);
    assignIfPresent('currentZipCode', (v) => v ?? null);
    assignIfPresent('currentCountry', (v) => v ?? null);
    assignIfPresent('permanentAddress', (v) => v ?? null);
    assignIfPresent('permanentCity', (v) => v ?? null);
    assignIfPresent('permanentState', (v) => v ?? null);
    assignIfPresent('permanentZipCode', (v) => v ?? null);
    assignIfPresent('permanentCountry', (v) => v ?? null);
    assignIfPresent('emergencyContactName', (v) => v ?? null);
    assignIfPresent('emergencyContactNumber', (v) => v ?? null);
    assignIfPresent('emergencyContactRelation', (v) => v ?? null);

    return data;
  }

  private buildLink(rawToken: string): string {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    return `${frontendUrl}/pre-onboarding/${rawToken}`;
  }

  private async sendInviteEmail(invite: InviteRow, link: string): Promise<void> {
    const to = invite.employee.personalEmail || invite.employee.email;
    try {
      await this.email.sendEmail({
        to,
        subject: 'Complete your pre-onboarding details',
        template: 'pre-onboarding-invite',
        context: {
          firstName: invite.employee.firstName,
          joinDate: invite.employee.joinDate.toISOString().slice(0, 10),
          link,
          expiresAt: invite.expiresAt.toISOString().slice(0, 10),
        },
      });
    } catch (error) {
      this.logger.warn(`Pre-onboarding invite email failed for invite ${invite.id}: ${error}`);
    }
  }

  private documentStates(invite: InviteRow): PreOnboardingDocumentState[] {
    const requiredDocuments = invite.requiredDocuments as unknown as PreOnboardingDocumentDefinition[];
    return requiredDocuments.map((def) => {
      const uploaded = invite.documents.find((d) => d.documentKey === def.key);
      return {
        ...def,
        uploaded: !!uploaded,
        fileName: uploaded?.employeeDocument.upload.fileName ?? null,
        uploadedAt: uploaded ? uploaded.uploadedAt.toISOString() : null,
        verified: uploaded?.employeeDocument.isVerified ?? false,
      };
    });
  }

  private toInviteView(invite: InviteRow): PreOnboardingInviteView {
    return {
      id: invite.id,
      employee: {
        id: invite.employee.id,
        employeeCode: invite.employee.employeeCode,
        firstName: invite.employee.firstName,
        lastName: invite.employee.lastName,
        joinDate: invite.employee.joinDate.toISOString().slice(0, 10),
      },
      offerId: invite.offerId,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      submittedAt: invite.submittedAt ? invite.submittedAt.toISOString() : null,
      lastAccessedAt: invite.lastAccessedAt ? invite.lastAccessedAt.toISOString() : null,
      documents: this.documentStates(invite),
      personalDetails: (invite.personalDetails as unknown as PreOnboardingPersonalDetails | null) ?? null,
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private toPublicView(invite: InviteRow): PublicPreOnboardingView {
    return {
      company: { name: invite.tenant.name, logoUrl: invite.tenant.logoUrl ?? null },
      employeeFirstName: invite.employee.firstName,
      joinDate: invite.employee.joinDate.toISOString().slice(0, 10),
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      documents: this.documentStates(invite).map(({ verified, category, ...rest }) => rest),
      personalDetails: (invite.personalDetails as unknown as PreOnboardingPersonalDetails | null) ?? null,
    };
  }
}
