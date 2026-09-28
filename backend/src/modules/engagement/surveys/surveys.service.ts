import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EngagementAudience, NotificationType, SurveyStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CreateSurveyDto,
  ListSurveysDto,
  SurveyQuestionDto,
  UpdateSurveyDto,
} from './dto/survey.dto';

/** Choice questions need 2-20 distinct, non-empty, trimmed options. */
function normalizeQuestionOptions(q: SurveyQuestionDto): string[] {
  const isChoice = q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE';
  if (!isChoice) {
    return [];
  }
  const trimmed = (q.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  const distinct = new Set(trimmed);
  if (distinct.size !== trimmed.length || trimmed.length < 2 || trimmed.length > 20) {
    throw new BadRequestException(
      `${q.type} questions need 2-20 distinct, non-empty options`,
    );
  }
  return trimmed;
}

@Injectable()
export class SurveysService {
  private readonly logger = new Logger(SurveysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** `audienceIds` must belong to the tenant for DEPARTMENT/BRANCH audiences. */
  private async validateAudience(
    tenantId: string,
    audienceType: EngagementAudience,
    audienceIds: string[],
  ) {
    if (audienceType === EngagementAudience.ALL) return;
    if (!audienceIds || audienceIds.length === 0) {
      throw new BadRequestException(
        'audienceIds is required for a DEPARTMENT or BRANCH audience',
      );
    }
    const count =
      audienceType === EngagementAudience.DEPARTMENT
        ? await this.prisma.department.count({
            where: { tenantId, id: { in: audienceIds } },
          })
        : await this.prisma.branch.count({
            where: { tenantId, id: { in: audienceIds } },
          });
    if (count !== audienceIds.length) {
      throw new BadRequestException(
        'One or more audience ids do not belong to this tenant',
      );
    }
  }

  async create(tenantId: string, createdById: string, dto: CreateSurveyDto) {
    await this.validateAudience(tenantId, dto.audienceType, dto.audienceIds);
    if (dto.closesAt && new Date(dto.closesAt) <= new Date()) {
      throw new BadRequestException('closesAt must be in the future');
    }
    // Validated up front so a bad question shape never reaches the DB.
    const questionOptions = dto.questions.map((q) => normalizeQuestionOptions(q));

    const survey = await this.prisma.$transaction(async (tx) => {
      const created = await tx.survey.create({
        data: {
          tenantId,
          title: dto.title,
          description: dto.description,
          isAnonymous: dto.isAnonymous ?? false,
          audienceType: dto.audienceType,
          audienceIds: dto.audienceType === EngagementAudience.ALL ? [] : dto.audienceIds,
          closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
          createdById,
        },
      });
      await tx.surveyQuestion.createMany({
        data: dto.questions.map((q, index) => ({
          tenantId,
          surveyId: created.id,
          order: index,
          type: q.type,
          text: q.text,
          required: q.required ?? true,
          options: questionOptions[index],
        })),
      });
      return created;
    });

    return this.findById(tenantId, survey.id);
  }

  async findAll(tenantId: string, query: ListSurveysDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: { tenantId: string; status?: SurveyStatus } = { tenantId };
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.survey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { questions: { orderBy: { order: 'asc' } } },
      }),
      this.prisma.survey.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(tenantId: string, id: string) {
    const survey = await this.prisma.survey.findFirst({
      where: { id, tenantId },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!survey) throw new NotFoundException('Survey not found');
    return survey;
  }

  async update(tenantId: string, id: string, dto: UpdateSurveyDto) {
    const survey = await this.findById(tenantId, id);
    if (survey.status !== SurveyStatus.DRAFT) {
      throw new BadRequestException('Only a draft survey can be edited');
    }

    // The effective audience after this update: a caller may send only
    // `audienceType` (keep the old ids, or clear them for ALL), only
    // `audienceIds` (keep the old type), or both. Whichever fields are
    // supplied, `audienceType` and `audienceIds` below are always the pair
    // that gets validated AND the pair that gets written — never a mix of
    // the new value for one and the stale value for the other.
    const audienceChanged = dto.audienceType !== undefined || dto.audienceIds !== undefined;
    const audienceType = dto.audienceType ?? survey.audienceType;
    if (
      dto.audienceType === undefined &&
      dto.audienceIds !== undefined &&
      survey.audienceType === EngagementAudience.ALL
    ) {
      throw new BadRequestException(
        'audienceType is required to set audienceIds when the current audience is ALL',
      );
    }
    const audienceIds =
      audienceType === EngagementAudience.ALL
        ? []
        : dto.audienceIds ?? survey.audienceIds;
    if (audienceChanged) {
      await this.validateAudience(tenantId, audienceType, audienceIds);
    }
    if (dto.closesAt && new Date(dto.closesAt) <= new Date()) {
      throw new BadRequestException('closesAt must be in the future');
    }
    // Validated up front so a bad question shape never reaches the DB.
    const questionOptions = dto.questions?.map((q) => normalizeQuestionOptions(q));

    await this.prisma.$transaction(async (tx) => {
      await tx.survey.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          isAnonymous: dto.isAnonymous,
          audienceType: audienceChanged ? audienceType : undefined,
          audienceIds: audienceChanged ? audienceIds : undefined,
          closesAt:
            dto.closesAt === undefined ? undefined : dto.closesAt ? new Date(dto.closesAt) : null,
        },
      });

      if (dto.questions && questionOptions) {
        await tx.surveyQuestion.deleteMany({ where: { surveyId: id } });
        await tx.surveyQuestion.createMany({
          data: dto.questions.map((q, index) => ({
            tenantId,
            surveyId: id,
            order: index,
            type: q.type,
            text: q.text,
            required: q.required ?? true,
            options: questionOptions[index],
          })),
        });
      }
    });

    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string) {
    const survey = await this.findById(tenantId, id);
    if (survey.status !== SurveyStatus.DRAFT) {
      throw new BadRequestException('Only a draft survey can be deleted');
    }
    await this.prisma.survey.delete({ where: { id } });
    return { deleted: true };
  }

  private audienceWhere(
    tenantId: string,
    survey: { audienceType: EngagementAudience; audienceIds: string[] },
  ) {
    const where: {
      tenantId: string;
      status: 'ACTIVE';
      departmentId?: { in: string[] };
      branchId?: { in: string[] };
    } = { tenantId, status: 'ACTIVE' };
    if (survey.audienceType === EngagementAudience.DEPARTMENT) {
      where.departmentId = { in: survey.audienceIds };
    } else if (survey.audienceType === EngagementAudience.BRANCH) {
      where.branchId = { in: survey.audienceIds };
    }
    return where;
  }

  async launch(tenantId: string, id: string) {
    const survey = await this.prisma.survey.findFirst({ where: { id, tenantId } });
    if (!survey) throw new NotFoundException('Survey not found');
    if (survey.closesAt && survey.closesAt <= new Date()) {
      throw new BadRequestException('closesAt must be in the future to launch');
    }

    const employees = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.survey.updateMany({
        where: { id, tenantId, status: SurveyStatus.DRAFT },
        data: { status: SurveyStatus.ACTIVE, launchedAt: new Date() },
      });
      if (flipped.count === 0) {
        throw new ConflictException('Survey is not a draft');
      }

      const audienceEmployees = await tx.employee.findMany({
        where: this.audienceWhere(tenantId, survey),
        select: { id: true },
      });
      if (audienceEmployees.length === 0) {
        throw new BadRequestException('The audience has no active employees');
      }

      await tx.surveyParticipant.createMany({
        data: audienceEmployees.map((e) => ({ tenantId, surveyId: id, employeeId: e.id })),
        skipDuplicates: true,
      });

      return audienceEmployees;
    });

    try {
      await this.notifyLaunch(
        tenantId,
        id,
        survey.title,
        employees.map((e) => e.id),
      );
    } catch (err) {
      this.logger.error(`Failed to notify survey launch ${id}`, err as Error);
    }

    return this.findById(tenantId, id);
  }

  private async notifyLaunch(
    tenantId: string,
    surveyId: string,
    title: string,
    employeeIds: string[],
  ) {
    const users = await this.prisma.user.findMany({
      where: { tenantId, employeeId: { in: employeeIds }, isActive: true },
      select: { id: true },
    });
    if (users.length === 0) return;
    await this.notifications.createMany(
      users.map((u) => ({
        tenantId,
        userId: u.id,
        type: NotificationType.SURVEY_LAUNCHED,
        title: 'New survey',
        message: title,
        link: `/engagement/surveys/${surveyId}`,
      })),
    );
  }

  async close(tenantId: string, id: string) {
    const closed = await this.prisma.survey.updateMany({
      where: { id, tenantId, status: SurveyStatus.ACTIVE },
      data: { status: SurveyStatus.CLOSED, closedAt: new Date() },
    });
    if (closed.count === 0) {
      throw new BadRequestException('Only an active survey can be closed');
    }
    return this.findById(tenantId, id);
  }

  async mine(tenantId: string, employeeId: string) {
    const participants = await this.prisma.surveyParticipant.findMany({
      where: { tenantId, employeeId },
      include: { survey: { include: { _count: { select: { questions: true } } } } },
    });

    const now = new Date();
    const rows = participants.map((p) => {
      const isOpen =
        p.survey.status === SurveyStatus.ACTIVE &&
        (!p.survey.closesAt || p.survey.closesAt > now);
      return {
        id: p.survey.id,
        title: p.survey.title,
        description: p.survey.description,
        isAnonymous: p.survey.isAnonymous,
        status: p.survey.status,
        closesAt: p.survey.closesAt,
        launchedAt: p.survey.launchedAt,
        questionCount: p.survey._count.questions,
        submitted: p.submitted,
        isOpen,
      };
    });

    return rows.sort((a, b) => {
      const aOpenUnsubmitted = a.isOpen && !a.submitted;
      const bOpenUnsubmitted = b.isOpen && !b.submitted;
      if (aOpenUnsubmitted !== bOpenUnsubmitted) return aOpenUnsubmitted ? -1 : 1;
      const aTime = a.launchedAt ? a.launchedAt.getTime() : 0;
      const bTime = b.launchedAt ? b.launchedAt.getTime() : 0;
      return bTime - aTime;
    });
  }

  async form(tenantId: string, employeeId: string, id: string) {
    const participant = await this.prisma.surveyParticipant.findFirst({
      where: { tenantId, employeeId, surveyId: id },
    });
    if (!participant) throw new NotFoundException('Survey not found');

    const survey = await this.prisma.survey.findFirst({
      where: { id, tenantId },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!survey) throw new NotFoundException('Survey not found');

    return { ...survey, submitted: participant.submitted };
  }
}
