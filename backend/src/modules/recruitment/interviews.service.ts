import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InterviewStatus,
  JobApplicationStatus,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/email/email.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  EmployeeSummary,
  FeedbackScore,
  InterviewFeedbackListView,
  InterviewFeedbackView,
  InterviewView,
} from './recruitment.types';
import {
  MAX_FEEDBACK_SCORES,
  MAX_PANELISTS,
  ScheduleInterviewDto,
  SubmitFeedbackDto,
  UpdateInterviewDto,
} from './dto/interview.dto';

export const INTERVIEWS_LINK = '/recruitment/interviews';

const employeeSummarySelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
} as const;

const interviewInclude = {
  application: {
    select: {
      id: true,
      status: true,
      candidate: { select: { id: true, firstName: true, lastName: true } },
      jobOpening: { select: { id: true, title: true, hiringManagerId: true } },
    },
  },
  panel: {
    select: {
      employeeId: true,
      employee: { select: { ...employeeSummarySelect, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  feedback: { select: { interviewerEmployeeId: true } },
} satisfies Prisma.InterviewInclude;

type InterviewRow = Prisma.InterviewGetPayload<{ include: typeof interviewInclude }>;

const feedbackInclude = {
  interviewer: { select: employeeSummarySelect },
} satisfies Prisma.InterviewFeedbackInclude;

type FeedbackRow = Prisma.InterviewFeedbackGetPayload<{ include: typeof feedbackInclude }>;

type TerminalInterviewStatus = 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';

function isHr(actor: AuthenticatedUser): boolean {
  return actor.role === UserRole.HR_ADMIN || actor.role === UserRole.SUPER_ADMIN;
}

function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

function parseScores(json: Prisma.JsonValue): FeedbackScore[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((s): s is Prisma.JsonObject => !!s && typeof s === 'object' && !Array.isArray(s))
    .map((s) => ({
      criterion: String(s.criterion ?? ''),
      rating: Number(s.rating ?? 0),
      comment: typeof s.comment === 'string' ? s.comment : null,
    }));
}

function trimOrNull(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/**
 * Interview scheduling with a panel, and scorecard feedback (Keka wave D2).
 *
 * Who: HR / SUPER_ADMIN manage every interview; a MANAGER only those of
 * openings they are the hiring manager of. Feedback is written only by the
 * panel, and read by HR, the hiring manager, and a panelist once they have
 * submitted their own.
 */
@Injectable()
export class InterviewsService {
  private readonly logger = new Logger(InterviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async listForApplication(actor: AuthenticatedUser, applicationId: string): Promise<InterviewView[]> {
    await this.loadApplicationForManage(actor, applicationId);
    const rows = await this.prisma.interview.findMany({
      where: { tenantId: actor.tenantId, applicationId },
      include: interviewInclude,
      orderBy: { scheduledStart: 'asc' },
    });
    return rows.map((r) => this.toView(r, actor));
  }

  async schedule(
    actor: AuthenticatedUser,
    applicationId: string,
    input: ScheduleInterviewDto,
  ): Promise<InterviewView> {
    const { tenantId } = actor;
    const app = await this.loadApplicationForManage(actor, applicationId);
    if (app.status !== JobApplicationStatus.ACTIVE) {
      throw new BadRequestException('Interviews can only be scheduled for an active application');
    }
    const { start, end } = this.parseWindow(input.scheduledStart, input.scheduledEnd);
    const panelIds = await this.validatePanel(tenantId, input.panelEmployeeIds);

    const created = await this.prisma.interview.create({
      data: {
        tenantId,
        applicationId,
        roundName: input.roundName.trim(),
        scheduledStart: start,
        scheduledEnd: end,
        mode: input.mode ?? 'VIDEO',
        location: trimOrNull(input.location),
        meetingLink: trimOrNull(input.meetingLink),
        notes: trimOrNull(input.notes),
        createdById: actor.userId,
        panel: { create: panelIds.map((employeeId) => ({ tenantId, employeeId })) },
      },
      include: interviewInclude,
    });

    await this.notifyPanel(tenantId, created, panelIds, 'scheduled');
    return this.toView(created, actor);
  }

  async update(actor: AuthenticatedUser, id: string, input: UpdateInterviewDto): Promise<InterviewView> {
    const { tenantId } = actor;
    const current = await this.loadInterview(tenantId, id);
    this.assertCanManage(actor, current.application.jobOpening.hiringManagerId);
    if (current.status !== InterviewStatus.SCHEDULED) {
      throw new BadRequestException('Only a scheduled interview can be changed');
    }

    const { start, end } = this.parseWindow(
      input.scheduledStart ?? current.scheduledStart,
      input.scheduledEnd ?? current.scheduledEnd,
    );

    const currentPanel = current.panel.map((p) => p.employeeId);
    let added: string[] = [];
    let removed: string[] = [];
    if (input.panelEmployeeIds) {
      const next = await this.validatePanel(tenantId, input.panelEmployeeIds);
      added = next.filter((e) => !currentPanel.includes(e));
      removed = currentPanel.filter((e) => !next.includes(e));
      const withFeedback = new Set(current.feedback.map((f) => f.interviewerEmployeeId));
      if (removed.some((e) => withFeedback.has(e))) {
        throw new BadRequestException('A panelist who has submitted feedback cannot be removed');
      }
    }

    const data: Prisma.InterviewUpdateInput = {
      scheduledStart: start,
      scheduledEnd: end,
    };
    if (input.roundName !== undefined) data.roundName = input.roundName.trim();
    if (input.mode !== undefined) data.mode = input.mode;
    if (input.location !== undefined) data.location = trimOrNull(input.location);
    if (input.meetingLink !== undefined) data.meetingLink = trimOrNull(input.meetingLink);
    if (input.notes !== undefined) data.notes = trimOrNull(input.notes);

    await this.prisma.$transaction(async (tx) => {
      await tx.interview.update({ where: { id }, data });
      if (removed.length) {
        await tx.interviewPanelist.deleteMany({ where: { interviewId: id, employeeId: { in: removed } } });
      }
      if (added.length) {
        await tx.interviewPanelist.createMany({
          data: added.map((employeeId) => ({ tenantId, interviewId: id, employeeId })),
          skipDuplicates: true,
        });
      }
    });

    const updated = await this.loadInterview(tenantId, id);
    const logisticsChanged =
      start.getTime() !== current.scheduledStart.getTime() ||
      end.getTime() !== current.scheduledEnd.getTime() ||
      (input.mode !== undefined && input.mode !== current.mode) ||
      (input.location !== undefined && trimOrNull(input.location) !== current.location) ||
      (input.meetingLink !== undefined && trimOrNull(input.meetingLink) !== current.meetingLink);
    const recipients = logisticsChanged ? updated.panel.map((p) => p.employeeId) : added;
    if (recipients.length) {
      await this.notifyPanel(tenantId, updated, recipients, logisticsChanged ? 'updated' : 'scheduled');
    }
    return this.toView(updated, actor);
  }

  async setStatus(
    actor: AuthenticatedUser,
    id: string,
    status: TerminalInterviewStatus,
  ): Promise<InterviewView> {
    const { tenantId } = actor;
    const current = await this.loadInterview(tenantId, id);
    this.assertCanManage(actor, current.application.jobOpening.hiringManagerId);
    if (current.status !== InterviewStatus.SCHEDULED) {
      throw new BadRequestException(`The interview is already ${current.status.toLowerCase().replace('_', '-')}`);
    }
    const guarded = await this.prisma.interview.updateMany({
      where: { id, tenantId, status: InterviewStatus.SCHEDULED },
      data: { status },
    });
    if (guarded.count === 0) {
      throw new ConflictException('The interview was changed by someone else; reload and try again');
    }
    return this.toView(await this.loadInterview(tenantId, id), actor);
  }

  async mine(actor: AuthenticatedUser): Promise<InterviewView[]> {
    // An undefined employeeId in a `where` would match every panel row.
    if (!actor.employeeId) return [];
    const rows = await this.prisma.interview.findMany({
      where: { tenantId: actor.tenantId, panel: { some: { employeeId: actor.employeeId } } },
      include: interviewInclude,
      orderBy: { scheduledStart: 'asc' },
    });
    return rows.map((r) => this.toView(r, actor));
  }

  async listFeedback(actor: AuthenticatedUser, interviewId: string): Promise<InterviewFeedbackListView> {
    const { tenantId } = actor;
    const interview = await this.loadInterview(tenantId, interviewId);
    const hiringManagerId = interview.application.jobOpening.hiringManagerId;
    const isHiringManager = !!actor.employeeId && actor.employeeId === hiringManagerId;
    const isPanelist =
      !!actor.employeeId && interview.panel.some((p) => p.employeeId === actor.employeeId);

    if (!isHr(actor) && !isHiringManager) {
      if (!isPanelist) {
        throw new ForbiddenException('You are not on this interview panel');
      }
      const submitted = interview.feedback.some((f) => f.interviewerEmployeeId === actor.employeeId);
      if (!submitted) {
        // Independent judgement: a panelist sees the others only after writing their own.
        return { visible: false, items: [] };
      }
    }

    const rows = await this.prisma.interviewFeedback.findMany({
      where: { tenantId, interviewId },
      include: feedbackInclude,
      orderBy: { submittedAt: 'asc' },
    });
    return { visible: true, items: rows.map((r) => this.toFeedbackView(r)) };
  }

  async submitFeedback(
    actor: AuthenticatedUser,
    interviewId: string,
    input: SubmitFeedbackDto,
  ): Promise<InterviewFeedbackView> {
    const { tenantId } = actor;
    const employeeId = actor.employeeId;
    if (!employeeId) {
      throw new ForbiddenException('Only interview panelists can submit feedback');
    }
    const interview = await this.loadInterview(tenantId, interviewId);
    if (!interview.panel.some((p) => p.employeeId === employeeId)) {
      throw new ForbiddenException('Only interview panelists can submit feedback');
    }
    if (
      interview.status === InterviewStatus.CANCELLED ||
      interview.status === InterviewStatus.NO_SHOW
    ) {
      throw new BadRequestException('Feedback cannot be given for a cancelled or no-show interview');
    }
    if (interview.application.status !== JobApplicationStatus.ACTIVE) {
      throw new BadRequestException('Feedback is closed: the application is no longer active');
    }
    if (!Number.isInteger(input.overallRating) || input.overallRating < 1 || input.overallRating > 5) {
      throw new BadRequestException('overallRating must be between 1 and 5');
    }
    const rawScores = input.scores ?? [];
    if (rawScores.length > MAX_FEEDBACK_SCORES) {
      throw new BadRequestException(`At most ${MAX_FEEDBACK_SCORES} score rows are allowed`);
    }
    const scores: FeedbackScore[] = rawScores.map((s) => ({
      criterion: s.criterion.trim(),
      rating: s.rating,
      comment: trimOrNull(s.comment),
    }));
    if (scores.some((s) => !s.criterion || !Number.isInteger(s.rating) || s.rating < 1 || s.rating > 5)) {
      throw new BadRequestException('Every score needs a criterion and a rating between 1 and 5');
    }

    const key = { interviewId, interviewerEmployeeId: employeeId };
    const existing = await this.prisma.interviewFeedback.findUnique({
      where: { interviewId_interviewerEmployeeId: key },
      select: { id: true },
    });
    const fields = {
      overallRating: input.overallRating,
      recommendation: input.recommendation,
      scores: scores as unknown as Prisma.InputJsonValue,
      strengths: trimOrNull(input.strengths),
      concerns: trimOrNull(input.concerns),
    };
    const row = await this.prisma.interviewFeedback.upsert({
      where: { interviewId_interviewerEmployeeId: key },
      create: { tenantId, ...key, ...fields },
      update: fields,
      include: feedbackInclude,
    });

    if (!existing) {
      const candidate = fullName(interview.application.candidate);
      const title = 'Interview feedback submitted';
      const message = `${fullName(row.interviewer)} rated ${candidate} (${interview.roundName}) ${input.overallRating}/5`;
      const link = `/recruitment/applications/${interview.application.id}`;
      try {
        await this.notifications.notifyByRole(
          tenantId,
          [UserRole.HR_ADMIN],
          NotificationType.INTERVIEW_FEEDBACK_SUBMITTED,
          title,
          message,
          link,
        );
        const hiringManagerId = interview.application.jobOpening.hiringManagerId;
        if (hiringManagerId && hiringManagerId !== employeeId) {
          await this.notifications.notifyEmployee(
            tenantId,
            hiringManagerId,
            NotificationType.INTERVIEW_FEEDBACK_SUBMITTED,
            title,
            message,
            link,
          );
        }
      } catch (error) {
        this.logger.warn(`Could not notify about feedback on ${interviewId}: ${(error as Error).message}`);
      }
    }

    return this.toFeedbackView(row);
  }

  // ---- helpers ---------------------------------------------------------------

  private assertCanManage(actor: AuthenticatedUser, hiringManagerId: string | null): void {
    if (isHr(actor)) return;
    if (
      actor.role === UserRole.MANAGER &&
      !!actor.employeeId &&
      !!hiringManagerId &&
      actor.employeeId === hiringManagerId
    ) {
      return;
    }
    throw new ForbiddenException('Only HR or the hiring manager of this opening can manage its interviews');
  }

  private async loadApplicationForManage(actor: AuthenticatedUser, applicationId: string) {
    const app = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, tenantId: actor.tenantId },
      select: {
        id: true,
        status: true,
        candidate: { select: { id: true, firstName: true, lastName: true } },
        jobOpening: { select: { id: true, title: true, hiringManagerId: true } },
      },
    });
    if (!app) throw new NotFoundException('Application not found');
    this.assertCanManage(actor, app.jobOpening.hiringManagerId);
    return app;
  }

  private async loadInterview(tenantId: string, id: string): Promise<InterviewRow> {
    const row = await this.prisma.interview.findFirst({
      where: { id, tenantId },
      include: interviewInclude,
    });
    if (!row) throw new NotFoundException('Interview not found');
    return row;
  }

  private parseWindow(startRaw: string | Date, endRaw: string | Date): { start: Date; end: Date } {
    const start = new Date(startRaw);
    const end = new Date(endRaw);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid interview time');
    }
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('The interview must end after it starts');
    }
    return { start, end };
  }

  /** 1–10 distinct active employees of the tenant. Returns the ids in input order. */
  private async validatePanel(tenantId: string, ids: string[] | undefined): Promise<string[]> {
    const unique = [...new Set(ids ?? [])];
    if (unique.length === 0 || unique.length > MAX_PANELISTS) {
      throw new BadRequestException(`The panel needs between 1 and ${MAX_PANELISTS} interviewers`);
    }
    const found = await this.prisma.employee.findMany({
      where: { tenantId, id: { in: unique }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('Every panelist must be an active employee');
    }
    return unique;
  }

  /** In-app notification + e-mail to the given panelists. Never throws. */
  private async notifyPanel(
    tenantId: string,
    interview: InterviewRow,
    employeeIds: string[],
    kind: 'scheduled' | 'updated',
  ): Promise<void> {
    try {
      const candidate = fullName(interview.application.candidate);
      const jobTitle = interview.application.jobOpening.title;
      const when = this.formatWhen(interview.scheduledStart, interview.scheduledEnd);
      const title = kind === 'scheduled' ? 'Interview scheduled' : 'Interview updated';
      const message = `${candidate} · ${jobTitle} · ${interview.roundName} · ${when}`;

      const users = await this.prisma.user.findMany({
        where: { tenantId, employeeId: { in: employeeIds }, isActive: true },
        select: { id: true },
      });
      if (users.length) {
        await this.notifications.createMany(
          users.map((u) => ({
            tenantId,
            userId: u.id,
            type: NotificationType.INTERVIEW_SCHEDULED,
            title,
            message,
            link: INTERVIEWS_LINK,
          })),
        );
      }

      const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      for (const p of interview.panel) {
        if (!employeeIds.includes(p.employeeId) || !p.employee.email) continue;
        this.email
          .sendEmail({
            to: p.employee.email,
            subject: `${title}: ${candidate} (${jobTitle})`,
            template: 'interview-scheduled',
            context: {
              heading: title,
              panelistName: p.employee.firstName,
              candidateName: candidate,
              jobTitle,
              roundName: interview.roundName,
              when,
              mode: interview.mode.replace('_', ' ').toLowerCase(),
              location: interview.location,
              meetingLink: interview.meetingLink,
              link: `${frontendUrl}${INTERVIEWS_LINK}`,
            },
          })
          .catch((err) => this.logger.error(`Failed to e-mail panelist ${p.employeeId}: ${err}`));
      }
    } catch (error) {
      this.logger.warn(`Could not notify the interview panel: ${(error as Error).message}`);
    }
  }

  private formatWhen(start: Date, end: Date): string {
    const opts: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' };
    const day = start.toLocaleDateString('en-IN', { ...opts, day: '2-digit', month: 'short', year: 'numeric' });
    const time = (d: Date) =>
      d.toLocaleTimeString('en-IN', { ...opts, hour: '2-digit', minute: '2-digit', hour12: true });
    return `${day}, ${time(start)} – ${time(end)} IST`;
  }

  private toView(row: InterviewRow, viewer: AuthenticatedUser): InterviewView {
    const panel: EmployeeSummary[] = row.panel.map((p) => ({
      id: p.employee.id,
      employeeCode: p.employee.employeeCode,
      firstName: p.employee.firstName,
      lastName: p.employee.lastName,
    }));
    const feedbackSubmittedBy = row.feedback.map((f) => f.interviewerEmployeeId);
    const isPanelist = !!viewer.employeeId && row.panel.some((p) => p.employeeId === viewer.employeeId);
    const open = row.status === InterviewStatus.SCHEDULED || row.status === InterviewStatus.COMPLETED;
    return {
      id: row.id,
      applicationId: row.applicationId,
      candidate: {
        id: row.application.candidate.id,
        firstName: row.application.candidate.firstName,
        lastName: row.application.candidate.lastName,
      },
      jobOpening: { id: row.application.jobOpening.id, title: row.application.jobOpening.title },
      roundName: row.roundName,
      scheduledStart: row.scheduledStart.toISOString(),
      scheduledEnd: row.scheduledEnd.toISOString(),
      mode: row.mode,
      location: row.location,
      meetingLink: row.meetingLink,
      status: row.status,
      notes: row.notes,
      panel,
      feedbackSubmittedBy,
      myFeedbackDue:
        isPanelist &&
        open &&
        row.application.status === JobApplicationStatus.ACTIVE &&
        !feedbackSubmittedBy.includes(viewer.employeeId as string),
    };
  }

  private toFeedbackView(row: FeedbackRow): InterviewFeedbackView {
    return {
      id: row.id,
      interviewId: row.interviewId,
      interviewer: {
        id: row.interviewer.id,
        employeeCode: row.interviewer.employeeCode,
        firstName: row.interviewer.firstName,
        lastName: row.interviewer.lastName,
      },
      overallRating: row.overallRating,
      recommendation: row.recommendation,
      scores: parseScores(row.scores),
      strengths: row.strengths,
      concerns: row.concerns,
      submittedAt: row.submittedAt.toISOString(),
    };
  }
}
