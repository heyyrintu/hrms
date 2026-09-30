import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PollStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { PollReleaseService } from './poll-release.service';
import { CreatePollDto } from './dto/create-poll.dto';
import { VoteDto } from './dto/vote.dto';

export interface PollOptionView {
  id: string;
  order: number;
  label: string;
  voteCount: number | null;
}

export interface ActivePollView {
  id: string;
  question: string;
  closesAt: Date | null;
  createdAt: Date;
  hasVoted: boolean;
  /** Applied votes only; votes still in the pending buffer are in `pendingVotes`. */
  totalVotes: number | null;
  /** Votes cast but not yet applied to the option counts (null when counts are hidden). */
  pendingVotes: number | null;
  options: PollOptionView[];
}

export interface RecentClosedPollView {
  id: string;
  question: string;
  /** When the poll stopped accepting votes: `closedAt`, else the passed `closesAt`. */
  closedAt: Date;
  totalVotes: number;
  /** Votes cast but not yet applied to the option counts. */
  pendingVotes: number;
  options: { id: string; order: number; label: string; voteCount: number }[];
}

const RECENT_CLOSED_WINDOW_DAYS = 30;
const RECENT_CLOSED_LIMIT = 5;

/**
 * Anonymous, single-choice, whole-tenant polls.
 *
 * A vote never writes an option row in the transaction that inserts the
 * voter's `PollVoter` row (they would share PostgreSQL's `xmin`, naming the
 * latest voter's choice). It buffers an encrypted pending vote instead, and
 * `PollReleaseService` applies the counts in batches.
 */
@Injectable()
export class PollsService {
  private readonly logger = new Logger(PollsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
    private readonly release: PollReleaseService,
  ) {}

  async create(tenantId: string, createdById: string, dto: CreatePollDto) {
    const trimmed = dto.options.map((o) => o.trim());
    if (trimmed.some((o) => o.length === 0)) {
      throw new BadRequestException('Options cannot be empty');
    }
    const distinct = new Set(trimmed.map((o) => o.toLowerCase()));
    if (distinct.size !== trimmed.length) {
      throw new BadRequestException('Options must be distinct');
    }

    return this.prisma.$transaction(async (tx) => {
      const poll = await tx.poll.create({
        data: {
          tenantId,
          question: dto.question,
          createdById,
          closesAt: dto.closesAt ? new Date(dto.closesAt) : null,
        },
      });

      await tx.pollOption.createMany({
        data: trimmed.map((label, order) => ({ tenantId, pollId: poll.id, order, label })),
      });

      const options = await tx.pollOption.findMany({
        where: { pollId: poll.id },
        orderBy: { order: 'asc' },
      });

      return { ...poll, options };
    });
  }

  async active(
    tenantId: string,
    employeeId: string | undefined,
    isAdmin: boolean,
  ): Promise<ActivePollView[]> {
    const now = new Date();
    const polls = await this.prisma.poll.findMany({
      where: {
        tenantId,
        status: PollStatus.ACTIVE,
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
      },
      include: {
        options: { orderBy: { order: 'asc' } },
        _count: { select: { pending: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (polls.length === 0) return [];

    // Guarded: an undefined employeeId in a Prisma `where` matches every row,
    // which would mark every poll as voted for a caller with no employee
    // record (e.g. a SUPER_ADMIN). Skip the lookup entirely instead.
    const votedPollIds = new Set<string>();
    if (employeeId) {
      const myVotes = await this.prisma.pollVoter.findMany({
        where: { pollId: { in: polls.map((p) => p.id) }, employeeId },
        select: { pollId: true },
      });
      for (const v of myVotes) votedPollIds.add(v.pollId);
    }

    return polls.map((poll) => {
      const hasVoted = votedPollIds.has(poll.id);
      const showCounts = hasVoted || isAdmin;
      const totalVotes = showCounts
        ? poll.options.reduce((sum, o) => sum + o.voteCount, 0)
        : null;
      return {
        id: poll.id,
        question: poll.question,
        closesAt: poll.closesAt,
        createdAt: poll.createdAt,
        hasVoted,
        totalVotes,
        pendingVotes: showCounts ? poll._count?.pending ?? 0 : null,
        options: poll.options.map((o) => ({
          id: o.id,
          order: o.order,
          label: o.label,
          voteCount: showCounts ? o.voteCount : null,
        })),
      };
    });
  }

  /**
   * Polls that stopped accepting votes in the last 30 days: explicitly CLOSED,
   * or still ACTIVE with a `closesAt` that has passed. The poll is over, so
   * counts are visible to every caller; no voter lookup is needed.
   */
  async recentClosed(tenantId: string): Promise<RecentClosedPollView[]> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - RECENT_CLOSED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const polls = await this.prisma.poll.findMany({
      where: {
        tenantId,
        OR: [
          { status: PollStatus.CLOSED, closedAt: { gte: cutoff } },
          { status: PollStatus.ACTIVE, closesAt: { gte: cutoff, lte: now } },
        ],
      },
      include: {
        options: { orderBy: { order: 'asc' } },
        _count: { select: { pending: true } },
      },
    });

    return polls
      .map((poll) => ({ poll, endedAt: (poll.closedAt ?? poll.closesAt) as Date }))
      .sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime())
      .slice(0, RECENT_CLOSED_LIMIT)
      .map(({ poll, endedAt }) => ({
        id: poll.id,
        question: poll.question,
        closedAt: endedAt,
        totalVotes: poll.options.reduce((sum, o) => sum + o.voteCount, 0),
        pendingVotes: poll._count?.pending ?? 0,
        options: poll.options.map((o) => ({
          id: o.id,
          order: o.order,
          label: o.label,
          voteCount: o.voteCount,
        })),
      }));
  }

  async list(tenantId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.poll.findMany({
        where: { tenantId },
        include: {
          options: { orderBy: { order: 'asc' } },
          _count: { select: { pending: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.poll.count({ where: { tenantId } }),
    ]);

    return {
      data: data.map(({ _count, ...poll }) => ({
        ...poll,
        totalVotes: poll.options.reduce((sum, o) => sum + o.voteCount, 0),
        pendingVotes: _count?.pending ?? 0,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async vote(tenantId: string, id: string, employeeId: string, dto: VoteDto): Promise<{ success: true }> {
    // Encrypt before any write: a missing FIELD_ENCRYPTION_KEY fails with a
    // 500 here and nothing is recorded.
    const payload = this.fieldEncryption.encrypt(dto.optionId);

    await this.prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findFirst({
        where: { id, tenantId },
        include: { options: true },
      });
      if (!poll) throw new NotFoundException('Poll not found');
      if (poll.status !== PollStatus.ACTIVE || (poll.closesAt && poll.closesAt <= new Date())) {
        throw new BadRequestException('This poll is closed');
      }
      if (!poll.options.some((o) => o.id === dto.optionId)) {
        throw new BadRequestException('Invalid option');
      }

      try {
        await tx.pollVoter.create({ data: { tenantId, pollId: id, employeeId } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('You have already voted');
        }
        throw e;
      }

      await tx.pollPendingVote.create({
        data: { tenantId, pollId: id, payload },
        select: { id: true },
      });
    });

    // The vote is recorded; a failed release is retried on close and by the
    // cron. Log without any user or employee identifier.
    try {
      await this.release.release(tenantId, id, { force: false });
    } catch (err) {
      this.logger.error(`Poll vote release failed for poll ${id}: ${(err as Error).message}`);
    }

    return { success: true };
  }

  async close(tenantId: string, id: string): Promise<{ success: true }> {
    const result = await this.prisma.poll.updateMany({
      where: { id, tenantId, status: PollStatus.ACTIVE },
      data: { status: PollStatus.CLOSED, closedAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException('Poll is already closed or does not exist');
    }
    // Apply any votes still waiting for a batch: no later vote can join it.
    try {
      await this.release.release(tenantId, id, { force: true });
    } catch (err) {
      this.logger.error(
        `Failed to apply pending votes on close of poll ${id}: ${(err as Error).message}`,
      );
    }
    return { success: true };
  }

  async remove(tenantId: string, id: string): Promise<{ success: true }> {
    const poll = await this.prisma.poll.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!poll) throw new NotFoundException('Poll not found');
    await this.prisma.poll.delete({ where: { id } });
    return { success: true };
  }
}
