import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SurveyStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ENGAGEMENT_TIME_ZONE } from '../engagement-time';
import { SurveyReleaseService } from './survey-release.service';

/**
 * Safety net for the anonymous-response buffer. Every 15 minutes:
 * - surveys that are CLOSED or past `closesAt` are force-released (no later
 *   submit can join their batch);
 * - ACTIVE surveys get a normal release, which waits for a full batch.
 * Each survey is isolated so one failure does not stall the rest.
 */
@Injectable()
export class SurveyReleaseCronService {
  private readonly logger = new Logger(SurveyReleaseCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly release: SurveyReleaseService,
  ) {}

  @Cron('*/15 * * * *', { name: 'survey-release', timeZone: ENGAGEMENT_TIME_ZONE })
  async handleRelease(): Promise<void> {
    let surveys: { id: string; tenantId: string; status: SurveyStatus; closesAt: Date | null }[];
    try {
      surveys = await this.prisma.survey.findMany({
        where: { pending: { some: {} } },
        select: { id: true, tenantId: true, status: true, closesAt: true },
      });
    } catch (error) {
      this.logger.error(`Survey release sweep failed: ${(error as Error).message}`);
      return;
    }

    const now = new Date();
    for (const survey of surveys) {
      const force =
        survey.status === SurveyStatus.CLOSED ||
        (survey.closesAt !== null && survey.closesAt <= now);
      try {
        await this.release.release(survey.tenantId, survey.id, { force });
      } catch (error) {
        this.logger.error(
          `Survey release failed for survey ${survey.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
