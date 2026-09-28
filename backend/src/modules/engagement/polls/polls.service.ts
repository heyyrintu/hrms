import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PollStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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
  totalVotes: number | null;
  options: PollOptionView[];
}

/** Anonymous, single-choice, whole-tenant polls. */
@Injectable()
export class PollsService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { options: { orderBy: { order: 'asc' } } },
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
        options: poll.options.map((o) => ({
          id: o.id,
          order: o.order,
          label: o.label,
          voteCount: showCounts ? o.voteCount : null,
        })),
      };
    });
  }

  async list(tenantId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.poll.findMany({
        where: { tenantId },
        include: { options: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.poll.count({ where: { tenantId } }),
    ]);

    return {
      data: data.map((poll) => ({
        ...poll,
        totalVotes: poll.options.reduce((sum, o) => sum + o.voteCount, 0),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async vote(tenantId: string, id: string, employeeId: string, dto: VoteDto): Promise<{ success: true }> {
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

      await tx.pollOption.update({
        where: { id: dto.optionId },
        data: { voteCount: { increment: 1 } },
      });
    });

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
    return { success: true };
  }

  async remove(tenantId: string, id: string): Promise<{ success: true }> {
    const poll = await this.prisma.poll.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!poll) throw new NotFoundException('Poll not found');
    await this.prisma.poll.delete({ where: { id } });
    return { success: true };
  }
}
