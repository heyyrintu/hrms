import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JobApplicationStatus,
  JobOfferStatus,
  LetterType,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/email/email.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { WorkflowEntityContext } from '../workflow/workflow.types';
import { formatLetterDate, renderLetterContent, renderLetterPdf } from '../letters/letter-render';
import { ApplicationsService } from './applications.service';
import { generatePublicToken, hashPublicToken, isWellFormedPublicToken } from './public-token.util';
import { OfferView, PublicOfferView } from './recruitment.types';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

export const OFFERS_LINK = '/recruitment/offers';
export const OFFER_LINK_INVALID = 'This offer link is invalid or has expired';
export const OFFER_NOT_ANSWERABLE = 'This offer can no longer be answered';
export const OFFER_NO_LONGER_AVAILABLE = 'This offer is no longer available';
export const OFFER_CHANGED = 'The offer was changed by someone else; reload and try again';
export const DEFAULT_OFFER_EXPIRY_DAYS = 7;

/**
 * Stands in for `{{expiryDate}}` until the offer is sent: the expiry is only
 * fixed at sending time (now + offerExpiryDays) unless HR set one explicitly.
 * Replaced in the stored content by `send`, and for display before that.
 */
export const EXPIRY_MARKER = '⟦offer-expiry-date⟧';
const EXPIRY_PENDING_TEXT = '(date set when the offer is sent)';

/** DRAFT..SENT: at most one of these per application. */
export const LIVE_OFFER_STATUSES: JobOfferStatus[] = [
  JobOfferStatus.DRAFT,
  JobOfferStatus.PENDING_APPROVAL,
  JobOfferStatus.APPROVED,
  JobOfferStatus.REJECTED,
  JobOfferStatus.SENT,
];
const EDITABLE_STATUSES: JobOfferStatus[] = [JobOfferStatus.DRAFT, JobOfferStatus.REJECTED];
const DAY_MS = 86_400_000;

const employeeSummarySelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
} as const;

const offerInclude = {
  candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
  application: {
    select: {
      id: true,
      status: true,
      stage: { select: { id: true, sortOrder: true, category: true } },
      jobOpening: { select: { id: true, title: true } },
    },
  },
  template: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  reportingManager: { select: employeeSummarySelect },
  salaryStructure: { select: { id: true, name: true } },
} satisfies Prisma.JobOfferInclude;

type OfferRow = Prisma.JobOfferGetPayload<{ include: typeof offerInclude }>;

const publicInclude = {
  tenant: { select: { name: true, logoUrl: true } },
  candidate: { select: { firstName: true, lastName: true } },
  application: { select: { status: true, jobOpening: { select: { title: true } } } },
} satisfies Prisma.JobOfferInclude;

type PublicOfferRow = Prisma.JobOfferGetPayload<{ include: typeof publicInclude }>;

export interface PublicAnswerMeta {
  ip: string | null;
  userAgent: string | null;
}

function trimOrNull(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function money(value: Prisma.Decimal | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Case- and whitespace-insensitive comparison of a typed name. */
export function namesMatch(typed: string, expected: string): boolean {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const a = norm(typed);
  return a.length > 0 && a === norm(expected);
}

function parseJoiningDate(raw: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException('joiningDate must be YYYY-MM-DD');
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || ymd(date) !== raw) {
    throw new BadRequestException('joiningDate is not a valid date');
  }
  return date;
}

function parseExpiry(raw: string | null | undefined, now: Date): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('expiresAt is not a valid date');
  if (date.getTime() <= now.getTime()) throw new BadRequestException('expiresAt must be in the future');
  return date;
}

interface OfferFields {
  templateId: string;
  designationId: string | null;
  departmentId: string | null;
  branchId: string | null;
  reportingManagerId: string | null;
  employmentType: CreateOfferDto['employmentType'];
  annualCtc: number;
  monthlyBasePay: number | null;
  salaryStructureId: string | null;
  joiningDate: Date;
  expiresAt: Date | null;
}

/**
 * Job offers (Keka wave D2): rendered from OFFER_LETTER templates with the
 * letters module's isolated Handlebars environment, approved through the
 * workflow engine (OFFER), answered by the candidate through a public token
 * link. Only the SHA-256 of the token is stored.
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ApprovalEngineService,
    private readonly applications: ApplicationsService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ---- HR ------------------------------------------------------------------

  async list(actor: AuthenticatedUser, query: { status?: string }): Promise<OfferView[]> {
    const { tenantId } = actor;
    const status = query.status as JobOfferStatus | undefined;
    if (status && !Object.values(JobOfferStatus).includes(status)) {
      throw new BadRequestException('Unknown offer status');
    }
    await this.expireDue(tenantId);
    const rows = await this.prisma.jobOffer.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: offerInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<OfferView> {
    return this.toView(await this.expireIfDue(await this.findOrFail(actor.tenantId, id)));
  }

  async create(actor: AuthenticatedUser, applicationId: string, input: CreateOfferDto): Promise<OfferView> {
    const { tenantId } = actor;
    const app = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, tenantId },
      select: {
        id: true,
        status: true,
        candidateId: true,
        candidate: { select: { firstName: true, lastName: true, email: true } },
        jobOpening: { select: { title: true } },
      },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== JobApplicationStatus.ACTIVE) {
      throw new BadRequestException('Offers can only be made on an active application');
    }

    const now = new Date();
    const fields: OfferFields = {
      templateId: input.templateId,
      designationId: input.designationId ?? null,
      departmentId: input.departmentId ?? null,
      branchId: input.branchId ?? null,
      reportingManagerId: input.reportingManagerId ?? null,
      employmentType: input.employmentType ?? 'PERMANENT',
      annualCtc: Number(input.annualCtc),
      monthlyBasePay: input.monthlyBasePay ?? null,
      salaryStructureId: input.salaryStructureId ?? null,
      joiningDate: parseJoiningDate(input.joiningDate),
      expiresAt: parseExpiry(input.expiresAt, now),
    };
    const content = await this.render(tenantId, fields, app.candidate);

    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the application row: a concurrent create waits here, then sees
      // this offer in the check below instead of adding a second live one.
      await tx.jobApplication.update({ where: { id: applicationId }, data: { updatedAt: now } });
      const live = await tx.jobOffer.findFirst({
        where: { tenantId, applicationId, status: { in: LIVE_OFFER_STATUSES } },
        select: { id: true },
      });
      if (live) throw new ConflictException('This application already has an open offer');
      return tx.jobOffer.create({
        data: {
          tenantId,
          applicationId,
          candidateId: app.candidateId,
          ...this.fieldData(fields),
          content,
          status: JobOfferStatus.DRAFT,
          createdById: actor.userId,
        },
        include: offerInclude,
      });
    });
    return this.toView(created);
  }

  async update(actor: AuthenticatedUser, id: string, input: UpdateOfferDto): Promise<OfferView> {
    const { tenantId } = actor;
    const row = await this.findOrFail(tenantId, id);
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new BadRequestException('Only a draft or rejected offer can be edited');
    }
    const pick = <T>(next: T | undefined, current: T): T => (next === undefined ? current : next);
    const fields: OfferFields = {
      templateId: input.templateId ?? row.templateId,
      designationId: pick(input.designationId, row.designationId),
      departmentId: pick(input.departmentId, row.departmentId),
      branchId: pick(input.branchId, row.branchId),
      reportingManagerId: pick(input.reportingManagerId, row.reportingManagerId),
      employmentType: input.employmentType ?? row.employmentType,
      annualCtc: input.annualCtc !== undefined ? Number(input.annualCtc) : Number(row.annualCtc),
      monthlyBasePay:
        input.monthlyBasePay !== undefined
          ? input.monthlyBasePay
          : row.monthlyBasePay === null
            ? null
            : Number(row.monthlyBasePay),
      salaryStructureId: pick(input.salaryStructureId, row.salaryStructureId),
      joiningDate: input.joiningDate ? parseJoiningDate(input.joiningDate) : row.joiningDate,
      expiresAt:
        input.expiresAt !== undefined ? parseExpiry(input.expiresAt, new Date()) : row.expiresAt,
    };
    const content = await this.render(tenantId, fields, row.candidate);

    const guarded = await this.prisma.jobOffer.updateMany({
      where: { id, tenantId, status: { in: EDITABLE_STATUSES } },
      data: { ...this.fieldData(fields), content },
    });
    if (guarded.count === 0) throw new ConflictException(OFFER_CHANGED);
    return this.toView(await this.findOrFail(tenantId, id));
  }

  async submit(actor: AuthenticatedUser, id: string): Promise<OfferView> {
    const { tenantId } = actor;
    const row = await this.findOrFail(tenantId, id);
    if (!EDITABLE_STATUSES.includes(row.status)) {
      throw new BadRequestException('Only a draft or rejected offer can be submitted for approval');
    }
    if (row.application.status !== JobApplicationStatus.ACTIVE) {
      throw new BadRequestException('The application is no longer active');
    }

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.jobOffer.updateMany({
        where: { id, tenantId, status: { in: EDITABLE_STATUSES } },
        data: { status: JobOfferStatus.PENDING_APPROVAL, decisionNote: null },
      });
      if (guarded.count === 0) throw new ConflictException(OFFER_CHANGED);
      await this.engine.start({
        tenantId,
        entityType: 'OFFER',
        entityId: id,
        context: this.contextOf(row),
        tx,
      });
    });
    // After commit: tell the current step's approvers.
    void this.engine.notifyPending(tenantId, 'OFFER', id);
    return this.toView(await this.findOrFail(tenantId, id));
  }

  /** Engine path (unified approvals endpoint via OfferWorkflowHandler). */
  async approve(actor: AuthenticatedUser, id: string, note?: string | null): Promise<OfferView> {
    return this.decide(actor, id, 'APPROVE', note);
  }

  async reject(actor: AuthenticatedUser, id: string, note?: string | null): Promise<OfferView> {
    return this.decide(actor, id, 'REJECT', note);
  }

  async send(actor: AuthenticatedUser, id: string): Promise<OfferView> {
    const { tenantId } = actor;
    const row = await this.findOrFail(tenantId, id);
    if (row.status !== JobOfferStatus.APPROVED) {
      throw new BadRequestException('Only an approved offer can be sent');
    }
    if (row.application.status !== JobApplicationStatus.ACTIVE) {
      throw new BadRequestException('The application is no longer active');
    }

    const now = new Date();
    const settings = await this.prisma.recruitmentSettings.findUnique({
      where: { tenantId },
      select: { offerExpiryDays: true },
    });
    const days = settings?.offerExpiryDays ?? DEFAULT_OFFER_EXPIRY_DAYS;
    const expiresAt =
      row.expiresAt && row.expiresAt.getTime() > now.getTime()
        ? row.expiresAt
        : new Date(now.getTime() + days * DAY_MS);
    const content = row.content.split(EXPIRY_MARKER).join(formatLetterDate(expiresAt));
    const token = generatePublicToken();

    const offerStage = await this.prisma.pipelineStage.findFirst({
      where: { tenantId, category: 'OFFER', isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true },
    });
    const stage = row.application.stage;
    const moveToOffer =
      !!offerStage &&
      ['APPLIED', 'SCREENING', 'INTERVIEW'].includes(stage.category) &&
      stage.sortOrder < offerStage.sortOrder;

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.jobOffer.updateMany({
        where: { id, tenantId, status: JobOfferStatus.APPROVED },
        data: { status: JobOfferStatus.SENT, tokenHash: token.hash, sentAt: now, expiresAt, content },
      });
      if (guarded.count === 0) throw new ConflictException(OFFER_CHANGED);
      if (moveToOffer) {
        await this.applications.moveToStage({
          tenantId,
          applicationId: row.applicationId,
          toCategory: 'OFFER',
          actorUserId: actor.userId,
          note: 'Offer sent',
          tx,
        });
      }
    });

    await this.emailOffer(tenantId, row, token.raw, expiresAt);
    return this.toView(await this.findOrFail(tenantId, id));
  }

  async withdraw(actor: AuthenticatedUser, id: string): Promise<OfferView> {
    const { tenantId } = actor;
    const row = await this.findOrFail(tenantId, id);
    if (!LIVE_OFFER_STATUSES.includes(row.status)) {
      throw new BadRequestException(`A ${row.status.toLowerCase()} offer cannot be withdrawn`);
    }
    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.jobOffer.updateMany({
        where: { id, tenantId, status: { in: LIVE_OFFER_STATUSES } },
        data: { status: JobOfferStatus.WITHDRAWN },
      });
      if (guarded.count === 0) throw new ConflictException(OFFER_CHANGED);
      // Take it out of every approver's queue (no-op unless pending).
      await this.engine.cancel(tenantId, 'OFFER', id, tx);
    });
    return this.toView(await this.findOrFail(tenantId, id));
  }

  /** Null unless PENDING_APPROVAL. */
  async getWorkflowContext(tenantId: string, id: string): Promise<WorkflowEntityContext | null> {
    const row = await this.prisma.jobOffer.findFirst({
      where: { id, tenantId, status: JobOfferStatus.PENDING_APPROVAL },
      select: { createdById: true, annualCtc: true },
    });
    return row ? this.contextOf(row) : null;
  }

  async pdf(actor: AuthenticatedUser, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const row = await this.findOrFail(actor.tenantId, id);
    const name = fullName(row.candidate);
    const buffer = await renderLetterPdf({
      badge: 'OFFER LETTER',
      date: row.sentAt ?? row.createdAt,
      recipientName: name,
      recipientLine: row.application.jobOpening.title,
      content: this.presentContent(row.content, row.expiresAt),
    });
    const safe = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'candidate';
    return { buffer, fileName: `offer-${safe}.pdf` };
  }

  // ---- Public (token) --------------------------------------------------------

  async getPublic(rawToken: string): Promise<PublicOfferView> {
    return this.toPublicView(await this.resolvePublic(rawToken));
  }

  async acceptPublic(
    rawToken: string,
    input: { acceptedName: string },
    meta: PublicAnswerMeta,
  ): Promise<PublicOfferView> {
    const row = await this.resolvePublic(rawToken);
    this.assertAnswerable(row);
    if (row.application.status !== JobApplicationStatus.ACTIVE) {
      throw new BadRequestException(OFFER_NO_LONGER_AVAILABLE);
    }
    const typed = (input.acceptedName ?? '').trim();
    if (!namesMatch(typed, fullName(row.candidate))) {
      throw new BadRequestException('Please type your full name exactly as it appears on the offer');
    }

    const respondedAt = new Date();
    await this.answer(row, respondedAt, {
      status: JobOfferStatus.ACCEPTED,
      acceptedName: typed.slice(0, 200),
      respondedIp: meta.ip?.slice(0, 64) ?? null,
      respondedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    await this.notifyAnswered(row, true);
    return this.toPublicView({ ...row, status: JobOfferStatus.ACCEPTED, respondedAt });
  }

  async declinePublic(
    rawToken: string,
    input: { reason?: string | null },
    meta: PublicAnswerMeta,
  ): Promise<PublicOfferView> {
    const row = await this.resolvePublic(rawToken);
    this.assertAnswerable(row);
    const reason = trimOrNull(input.reason);
    if (reason && reason.length > 1000) {
      throw new BadRequestException('The reason can be at most 1000 characters');
    }

    const respondedAt = new Date();
    await this.answer(row, respondedAt, {
      status: JobOfferStatus.DECLINED,
      declineReason: reason,
      respondedIp: meta.ip?.slice(0, 64) ?? null,
      respondedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    await this.notifyAnswered(row, false, reason);
    return this.toPublicView({ ...row, status: JobOfferStatus.DECLINED, respondedAt });
  }

  // ---- internals -------------------------------------------------------------

  private async decide(
    actor: AuthenticatedUser,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    note?: string | null,
  ): Promise<OfferView> {
    const { tenantId } = actor;
    const row = await this.findOrFail(tenantId, id);
    if (row.status !== JobOfferStatus.PENDING_APPROVAL) {
      throw new BadRequestException('This offer is not awaiting approval');
    }
    const target = decision === 'APPROVE' ? JobOfferStatus.APPROVED : JobOfferStatus.REJECTED;

    const result = await this.engine.act({
      tenantId,
      entityType: 'OFFER',
      entityId: id,
      actor,
      decision,
      note,
      onFinal: async (tx) => {
        const guarded = await tx.jobOffer.updateMany({
          where: { id, tenantId, status: JobOfferStatus.PENDING_APPROVAL },
          data: { status: target, decisionNote: trimOrNull(note)?.slice(0, 1000) ?? null },
        });
        if (guarded.count === 0) throw new ConflictException(OFFER_CHANGED);
      },
    });

    if (result.outcome !== 'ADVANCED') {
      const approved = result.outcome === 'APPROVED';
      await this.notifyUser(
        tenantId,
        row.createdById,
        approved ? NotificationType.OFFER_APPROVED : NotificationType.OFFER_REJECTED,
        approved ? 'Offer approved' : 'Offer rejected',
        `The offer for ${fullName(row.candidate)} (${row.application.jobOpening.title}) was ${
          approved ? 'approved — it can now be sent' : 'rejected'
        }${!approved && trimOrNull(note) ? `: ${trimOrNull(note)}` : ''}`,
      );
    }
    return this.toView(await this.findOrFail(tenantId, id));
  }

  private contextOf(row: { createdById: string; annualCtc: Prisma.Decimal | number }): WorkflowEntityContext {
    return {
      requesterEmployeeId: null,
      requesterUserId: row.createdById,
      amount: Number(row.annualCtc),
    };
  }

  private async findOrFail(tenantId: string, id: string): Promise<OfferRow> {
    const row = await this.prisma.jobOffer.findFirst({ where: { id, tenantId }, include: offerInclude });
    if (!row) throw new NotFoundException('Offer not found');
    return row;
  }

  /** Lazily move every overdue SENT offer of the tenant to EXPIRED. */
  private async expireDue(tenantId: string): Promise<void> {
    await this.prisma.jobOffer.updateMany({
      where: { tenantId, status: JobOfferStatus.SENT, expiresAt: { lte: new Date() } },
      data: { status: JobOfferStatus.EXPIRED },
    });
  }

  private async expireIfDue<T extends { id: string; tenantId: string; status: JobOfferStatus; expiresAt: Date | null }>(
    row: T,
  ): Promise<T> {
    if (
      row.status === JobOfferStatus.SENT &&
      row.expiresAt &&
      row.expiresAt.getTime() <= Date.now()
    ) {
      await this.prisma.jobOffer.updateMany({
        where: { id: row.id, tenantId: row.tenantId, status: JobOfferStatus.SENT },
        data: { status: JobOfferStatus.EXPIRED },
      });
      return { ...row, status: JobOfferStatus.EXPIRED };
    }
    return row;
  }

  /** Token → offer; unknown, malformed and expired all answer the same 404. */
  private async resolvePublic(rawToken: string): Promise<PublicOfferRow> {
    if (!isWellFormedPublicToken(rawToken)) throw new NotFoundException(OFFER_LINK_INVALID);
    const found = await this.prisma.jobOffer.findUnique({
      where: { tokenHash: hashPublicToken(rawToken) },
      include: publicInclude,
    });
    if (!found) throw new NotFoundException(OFFER_LINK_INVALID);
    const row = await this.expireIfDue(found);
    if (row.status === JobOfferStatus.EXPIRED) throw new NotFoundException(OFFER_LINK_INVALID);
    return row;
  }

  private assertAnswerable(row: PublicOfferRow): void {
    if (row.status !== JobOfferStatus.SENT) {
      throw new BadRequestException(OFFER_NOT_ANSWERABLE);
    }
  }

  private async answer(
    row: PublicOfferRow,
    respondedAt: Date,
    data: Prisma.JobOfferUpdateManyMutationInput,
  ): Promise<void> {
    const guarded = await this.prisma.jobOffer.updateMany({
      where: {
        id: row.id,
        tenantId: row.tenantId,
        status: JobOfferStatus.SENT,
        OR: [{ expiresAt: null }, { expiresAt: { gt: respondedAt } }],
      },
      data: { ...data, respondedAt },
    });
    if (guarded.count === 0) {
      throw new ConflictException('This offer has already been answered');
    }
  }

  private async notifyAnswered(row: PublicOfferRow, accepted: boolean, reason?: string | null): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          tenantId: row.tenantId,
          isActive: true,
          OR: [{ role: UserRole.HR_ADMIN }, { id: row.createdById }],
        },
        select: { id: true },
      });
      if (users.length === 0) return;
      const who = `${fullName(row.candidate)} (${row.application.jobOpening.title})`;
      await this.notifications.createMany(
        users.map((u) => ({
          tenantId: row.tenantId,
          userId: u.id,
          type: accepted ? NotificationType.OFFER_ACCEPTED : NotificationType.OFFER_DECLINED,
          title: accepted ? 'Offer accepted' : 'Offer declined',
          message: accepted
            ? `${who} accepted the offer`
            : `${who} declined the offer${reason ? `: ${reason.slice(0, 200)}` : ''}`,
          link: OFFERS_LINK,
        })),
      );
    } catch (error) {
      this.logger.warn(`Could not notify about offer ${row.id}: ${(error as Error).message}`);
    }
  }

  private async notifyUser(
    tenantId: string,
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      await this.notifications.create({ tenantId, userId, type, title, message, link: OFFERS_LINK });
    } catch (error) {
      this.logger.warn(`Could not notify ${userId}: ${(error as Error).message}`);
    }
  }

  private async emailOffer(tenantId: string, row: OfferRow, rawToken: string, expiresAt: Date): Promise<void> {
    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      const companyName = tenant?.name ?? 'the company';
      this.email
        .sendEmail({
          to: row.candidate.email,
          subject: `Your offer from ${companyName}`,
          template: 'offer-sent',
          context: {
            candidateFirstName: row.candidate.firstName,
            companyName,
            jobTitle: row.application.jobOpening.title,
            link: `${frontendUrl}/offer/${rawToken}`,
            expiryDate: formatLetterDate(expiresAt),
          },
        })
        .catch((err) => this.logger.error(`Failed to e-mail offer ${row.id}: ${err}`));
    } catch (error) {
      this.logger.error(`Failed to e-mail offer ${row.id}: ${(error as Error).message}`);
    }
  }

  private fieldData(fields: OfferFields) {
    return {
      templateId: fields.templateId,
      designationId: fields.designationId,
      departmentId: fields.departmentId,
      branchId: fields.branchId,
      reportingManagerId: fields.reportingManagerId,
      employmentType: fields.employmentType ?? 'PERMANENT',
      annualCtc: fields.annualCtc,
      monthlyBasePay: fields.monthlyBasePay,
      salaryStructureId: fields.salaryStructureId,
      joiningDate: fields.joiningDate,
      expiresAt: fields.expiresAt,
    };
  }

  /**
   * Validate every referenced id against the tenant and render the template.
   * 400 for a missing / inactive / foreign reference.
   */
  private async render(
    tenantId: string,
    fields: OfferFields,
    candidate: { firstName: string; lastName: string; email: string },
  ): Promise<string> {
    if (!(fields.annualCtc > 0)) throw new BadRequestException('annualCtc must be positive');
    if (fields.monthlyBasePay !== null && fields.monthlyBasePay < 0) {
      throw new BadRequestException('monthlyBasePay cannot be negative');
    }

    const [template, designation, department, branch, manager, structure, tenant] = await Promise.all([
      this.prisma.letterTemplate.findFirst({
        where: { id: fields.templateId, tenantId, type: LetterType.OFFER_LETTER, isActive: true },
        select: { content: true },
      }),
      fields.designationId
        ? this.prisma.designation.findFirst({ where: { id: fields.designationId, tenantId }, select: { name: true } })
        : null,
      fields.departmentId
        ? this.prisma.department.findFirst({ where: { id: fields.departmentId, tenantId }, select: { name: true } })
        : null,
      fields.branchId
        ? this.prisma.branch.findFirst({ where: { id: fields.branchId, tenantId }, select: { name: true } })
        : null,
      fields.reportingManagerId
        ? this.prisma.employee.findFirst({
            where: { id: fields.reportingManagerId, tenantId },
            select: { firstName: true, lastName: true },
          })
        : null,
      fields.salaryStructureId
        ? this.prisma.salaryStructure.findFirst({
            where: { id: fields.salaryStructureId, tenantId, isActive: true },
            select: { id: true },
          })
        : null,
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, addressLine1: true, city: true, state: true, pinCode: true },
      }),
    ]);

    if (!template) throw new BadRequestException('Choose an active offer-letter template');
    if (fields.designationId && !designation) throw new BadRequestException('Designation not found');
    if (fields.departmentId && !department) throw new BadRequestException('Department not found');
    if (fields.branchId && !branch) throw new BadRequestException('Branch not found');
    if (fields.reportingManagerId && !manager) throw new BadRequestException('Reporting manager not found');
    if (fields.salaryStructureId && !structure) throw new BadRequestException('Salary structure not found');

    const variables: Record<string, string> = {
      candidateName: fullName(candidate),
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      designation: designation?.name ?? '',
      department: department?.name ?? '',
      branch: branch?.name ?? '',
      reportingManager: manager ? fullName(manager) : '',
      annualCtc: money(fields.annualCtc),
      monthlyBasePay: money(fields.monthlyBasePay),
      joiningDate: formatLetterDate(fields.joiningDate),
      expiryDate: fields.expiresAt ? formatLetterDate(fields.expiresAt) : EXPIRY_MARKER,
      companyName: tenant?.name ?? '',
      companyAddress: [tenant?.addressLine1, tenant?.city, tenant?.state, tenant?.pinCode]
        .filter(Boolean)
        .join(', '),
      currentDate: formatLetterDate(new Date()),
    };
    return renderLetterContent(template.content, variables);
  }

  private presentContent(content: string, expiresAt: Date | null): string {
    return content
      .split(EXPIRY_MARKER)
      .join(expiresAt ? formatLetterDate(expiresAt) : EXPIRY_PENDING_TEXT);
  }

  private toView(row: OfferRow): OfferView {
    return {
      id: row.id,
      applicationId: row.applicationId,
      candidate: {
        id: row.candidate.id,
        firstName: row.candidate.firstName,
        lastName: row.candidate.lastName,
        email: row.candidate.email,
      },
      jobOpening: { id: row.application.jobOpening.id, title: row.application.jobOpening.title },
      template: { id: row.template.id, name: row.template.name },
      content: this.presentContent(row.content, row.expiresAt),
      designation: row.designation,
      department: row.department,
      branch: row.branch,
      reportingManager: row.reportingManager,
      employmentType: row.employmentType,
      annualCtc: Number(row.annualCtc),
      monthlyBasePay: row.monthlyBasePay === null ? null : Number(row.monthlyBasePay),
      salaryStructure: row.salaryStructure,
      joiningDate: ymd(row.joiningDate),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      status: row.status,
      sentAt: row.sentAt?.toISOString() ?? null,
      respondedAt: row.respondedAt?.toISOString() ?? null,
      acceptedName: row.acceptedName,
      declineReason: row.declineReason,
      decisionNote: row.decisionNote,
      employeeId: row.employeeId,
      convertedAt: row.convertedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toPublicView(row: PublicOfferRow): PublicOfferView {
    return {
      company: { name: row.tenant.name, logoUrl: row.tenant.logoUrl },
      candidateFirstName: row.candidate.firstName,
      jobTitle: row.application.jobOpening.title,
      content: this.presentContent(row.content, row.expiresAt),
      annualCtc: Number(row.annualCtc),
      joiningDate: ymd(row.joiningDate),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      status: row.status,
      respondedAt: row.respondedAt?.toISOString() ?? null,
    };
  }
}
