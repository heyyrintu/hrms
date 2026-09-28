import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PollStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ENGAGEMENT_TIME_ZONE } from '../engagement-time';
import { PollReleaseService } from './poll-release.service';

/**
 * Safety net for the pending-vote buffer. Every 15 minutes: polls that are
 * CLOSED or past `closesAt` are force-applied (no later vote can join their
 * batch); ACTIVE polls get a normal release that waits for a full batch.
 * Each poll is isolated so one failure does not stall the rest.
 */
@Injectable()
export class PollReleaseCronService {
  private readonly logger = new Logger(PollReleaseCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly release: PollReleaseService,
  ) {}

  @Cron('*/15 * * * *', { name: 'poll-release', timeZone: ENGAGEMENT_TIME_ZONE })
  async handleRelease(): Promise<void> {
    let polls: { id: string; tenantId: string; status: PollStatus; closesAt: Date | null }[];
    try {
      polls = await this.prisma.poll.findMany({
        where: { pending: { some: {} } },
        select: { id: true, tenantId: true, status: true, closesAt: true },
      });
    } catch (error) {
      this.logger.error(`Poll release sweep failed: ${(error as Error).message}`);
      return;
    }

    const now = new Date();
    for (const poll of polls) {
      const force =
        poll.status === PollStatus.CLOSED || (poll.closesAt !== null && poll.closesAt <= now);
      try {
        await this.release.release(poll.tenantId, poll.id, { force });
      } catch (error) {
        this.logger.error(`Poll release failed for poll ${poll.id}: ${(error as Error).message}`);
      }
    }
  }
}
