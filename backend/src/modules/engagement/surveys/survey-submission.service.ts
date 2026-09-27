import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SurveyStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubmitSurveyDto } from './dto/survey.dto';
import { validateAnswers } from './survey-answer-validation';

/**
 * Submitting a survey response. Kept separate from `SurveysService` so the
 * anonymity-sensitive path is small and easy to review: no `@Audit()`
 * decorator anywhere near it, and no logging that could pair a user with a
 * response id.
 */
@Injectable()
export class SurveySubmissionService {
  constructor(private readonly prisma: PrismaService) {}

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

      const response = await tx.surveyResponse.create({
        data: {
          tenantId,
          surveyId,
          employeeId: survey.isAnonymous ? null : employeeId,
          submittedAt: survey.isAnonymous ? null : new Date(),
        },
        select: { id: true },
      });

      await tx.surveyAnswer.createMany({
        data: rows.map((r) => ({ tenantId, responseId: response.id, ...r })),
      });
    });

    return { submitted: true };
  }
}
