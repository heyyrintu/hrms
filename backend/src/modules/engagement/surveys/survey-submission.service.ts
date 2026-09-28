import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SurveyStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { SubmitSurveyDto } from './dto/survey.dto';
import { validateAnswers } from './survey-answer-validation';
import { SurveyReleaseService } from './survey-release.service';

/**
 * Submitting a survey response. Kept separate from `SurveysService` so the
 * anonymity-sensitive path is small and easy to review: no `@Audit()`
 * decorator anywhere near it, and no logging that could pair a user with a
 * response id.
 *
 * Anonymous surveys never write a response in the submit transaction: that
 * transaction also flips the participant flag (which names the employee), and
 * rows written by one transaction share PostgreSQL's `xmin`. Instead the
 * answers go into an encrypted pending buffer that `SurveyReleaseService`
 * later moves into `survey_responses` in shuffled batches.
 */
@Injectable()
export class SurveySubmissionService {
  private readonly logger = new Logger(SurveySubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
    private readonly release: SurveyReleaseService,
  ) {}

  async submit(
    tenantId: string,
    employeeId: string,
    surveyId: string,
    dto: SubmitSurveyDto,
  ) {
    const survey = await this.prisma.survey.findFirst({
      where: { id: surveyId, tenantId },
      include: { questions: true },
    });
    if (!survey) throw new NotFoundException('Survey not found');
    if (survey.status !== SurveyStatus.ACTIVE || (survey.closesAt && survey.closesAt <= new Date())) {
      throw new BadRequestException('This survey is closed');
    }

    const rows = validateAnswers(survey.questions, dto.answers);
    // Encrypt before any write: a missing FIELD_ENCRYPTION_KEY fails with a
    // 500 here and nothing is recorded.
    const payload = survey.isAnonymous
      ? this.fieldEncryption.encrypt(JSON.stringify(rows))
      : null;

    await this.prisma.$transaction(async (tx) => {
      const marked = await tx.surveyParticipant.updateMany({
        where: { tenantId, surveyId, employeeId, submitted: false },
        data: { submitted: true },
      });
      if (marked.count === 0) {
        const exists = await tx.surveyParticipant.findFirst({
          where: { tenantId, surveyId, employeeId },
          select: { id: true },
        });
        if (exists) throw new ConflictException('You have already responded');
        throw new NotFoundException('Survey not found');
      }

      if (payload !== null) {
        await tx.surveyPendingResponse.create({
          data: { tenantId, surveyId, payload },
          select: { id: true },
        });
        return;
      }

      const response = await tx.surveyResponse.create({
        data: { tenantId, surveyId, employeeId, submittedAt: new Date() },
        select: { id: true },
      });

      await tx.surveyAnswer.createMany({
        data: rows.map((r) => ({ tenantId, responseId: response.id, ...r })),
      });
    });

    if (payload !== null) {
      // The submission is already recorded; a failed release is retried on
      // close and by the cron. Log without any user or employee identifier.
      try {
        await this.release.release(tenantId, surveyId, { force: false });
      } catch (err) {
        this.logger.error(
          `Anonymous response release failed for survey ${surveyId}: ${(err as Error).message}`,
        );
      }
    }

    return { submitted: true };
  }
}
