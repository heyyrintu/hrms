import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PollsService } from './polls.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('PollsService', () => {
  let service: PollsService;
  let prisma: any;

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get(PollsService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('creates the poll and options in one transaction, order = index', async () => {
      prisma.poll.create.mockResolvedValue({ id: 'poll-1', tenantId, question: 'Q?' });
      prisma.pollOption.createMany.mockResolvedValue({ count: 2 });
      prisma.pollOption.findMany.mockResolvedValue([
        { id: 'opt-1', order: 0, label: 'A', voteCount: 0 },
        { id: 'opt-2', order: 1, label: 'B', voteCount: 0 },
      ]);

      await service.create(tenantId, employeeId, { question: 'Q?', options: ['A', 'B'] });

      expect(prisma.poll.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId, question: 'Q?', createdById: employeeId }),
        }),
      );
      expect(prisma.pollOption.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId, pollId: 'poll-1', order: 0, label: 'A' },
          { tenantId, pollId: 'poll-1', order: 1, label: 'B' },
        ],
      });
    });

    it('trims option labels before saving', async () => {
      prisma.poll.create.mockResolvedValue({ id: 'poll-1', tenantId, question: 'Q?' });
      prisma.pollOption.createMany.mockResolvedValue({ count: 2 });
      prisma.pollOption.findMany.mockResolvedValue([]);

      await service.create(tenantId, employeeId, { question: 'Q?', options: [' A ', 'B '] });

      expect(prisma.pollOption.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId, pollId: 'poll-1', order: 0, label: 'A' },
          { tenantId, pollId: 'poll-1', order: 1, label: 'B' },
        ],
      });
    });

    it('rejects options that are duplicates after trimming', async () => {
      await expect(
        service.create(tenantId, employeeId, { question: 'Q?', options: [' A', 'A '] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.poll.create).not.toHaveBeenCalled();
    });

    it('rejects an option that is empty after trimming', async () => {
      await expect(
        service.create(tenantId, employeeId, { question: 'Q?', options: ['A', '   '] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('active', () => {
    const now = new Date('2026-03-15T12:00:00Z');

    it('excludes polls whose closesAt has passed', async () => {
      prisma.poll.findMany.mockResolvedValue([]);

      await service.active(tenantId, employeeId, false);

      expect(prisma.poll.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            status: 'ACTIVE',
            OR: [{ closesAt: null }, { closesAt: { gt: expect.any(Date) } }],
          }),
        }),
      );
    });

    it('hides counts before the caller has voted and is not admin', async () => {
      prisma.poll.findMany.mockResolvedValue([
        {
          id: 'poll-1',
          question: 'Q?',
          closesAt: null,
          createdAt: now,
          options: [
            { id: 'opt-1', order: 0, label: 'A', voteCount: 3 },
            { id: 'opt-2', order: 1, label: 'B', voteCount: 1 },
          ],
        },
      ]);
      prisma.pollVoter.findMany.mockResolvedValue([]);

      const result = await service.active(tenantId, employeeId, false);

      expect(result[0].hasVoted).toBe(false);
      expect(result[0].totalVotes).toBeNull();
      expect(result[0].options[0].voteCount).toBeNull();
    });

    it('shows counts once the caller has voted', async () => {
      prisma.poll.findMany.mockResolvedValue([
        {
          id: 'poll-1',
          question: 'Q?',
          closesAt: null,
          createdAt: now,
          options: [
            { id: 'opt-1', order: 0, label: 'A', voteCount: 3 },
            { id: 'opt-2', order: 1, label: 'B', voteCount: 1 },
          ],
        },
      ]);
      prisma.pollVoter.findMany.mockResolvedValue([{ pollId: 'poll-1' }]);

      const result = await service.active(tenantId, employeeId, false);

      expect(result[0].hasVoted).toBe(true);
      expect(result[0].totalVotes).toBe(4);
      expect(result[0].options[0].voteCount).toBe(3);
    });

    it('always shows counts to an admin, even without voting', async () => {
      prisma.poll.findMany.mockResolvedValue([
        {
          id: 'poll-1',
          question: 'Q?',
          closesAt: null,
          createdAt: now,
          options: [{ id: 'opt-1', order: 0, label: 'A', voteCount: 3 }],
        },
      ]);
      prisma.pollVoter.findMany.mockResolvedValue([]);

      const result = await service.active(tenantId, employeeId, true);

      expect(result[0].totalVotes).toBe(3);
    });

    it('does not query pollVoter when there is no employeeId (e.g. an admin with no employee record)', async () => {
      prisma.poll.findMany.mockResolvedValue([
        {
          id: 'poll-1',
          question: 'Q?',
          closesAt: null,
          createdAt: now,
          options: [{ id: 'opt-1', order: 0, label: 'A', voteCount: 3 }],
        },
      ]);

      const result = await service.active(tenantId, undefined, true);

      expect(prisma.pollVoter.findMany).not.toHaveBeenCalled();
      expect(result[0].hasVoted).toBe(false);
    });
  });

  describe('vote', () => {
    const optionA = { id: 'opt-a', pollId: 'poll-1' };
    const activePoll = {
      id: 'poll-1',
      tenantId,
      status: 'ACTIVE',
      closesAt: null,
      options: [optionA],
    };

    it('votes: creates the voter row and increments the option count', async () => {
      prisma.poll.findFirst.mockResolvedValue(activePoll);
      prisma.pollVoter.create.mockResolvedValue({ id: 'voter-1' });

      await service.vote(tenantId, 'poll-1', employeeId, { optionId: 'opt-a' });

      expect(prisma.pollVoter.create).toHaveBeenCalledWith({
        data: { tenantId, pollId: 'poll-1', employeeId },
      });
      expect(prisma.pollOption.update).toHaveBeenCalledWith({
        where: { id: 'opt-a' },
        data: { voteCount: { increment: 1 } },
      });
    });

    it('404s when the poll does not exist in the tenant', async () => {
      prisma.poll.findFirst.mockResolvedValue(null);

      await expect(
        service.vote(tenantId, 'missing', employeeId, { optionId: 'opt-a' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('400s when the poll has passed its closesAt', async () => {
      prisma.poll.findFirst.mockResolvedValue({
        ...activePoll,
        closesAt: new Date('2020-01-01T00:00:00Z'),
      });

      await expect(
        service.vote(tenantId, 'poll-1', employeeId, { optionId: 'opt-a' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.pollVoter.create).not.toHaveBeenCalled();
    });

    it('400s on an unknown option', async () => {
      prisma.poll.findFirst.mockResolvedValue(activePoll);

      await expect(
        service.vote(tenantId, 'poll-1', employeeId, { optionId: 'not-a-real-option' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s and does not increment on a double vote', async () => {
      const { Prisma } = require('@prisma/client');
      prisma.poll.findFirst.mockResolvedValue(activePoll);
      prisma.pollVoter.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
      );

      await expect(
        service.vote(tenantId, 'poll-1', employeeId, { optionId: 'opt-a' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.pollOption.update).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes an active poll', async () => {
      prisma.poll.updateMany.mockResolvedValue({ count: 1 });

      await service.close(tenantId, 'poll-1');

      expect(prisma.poll.updateMany).toHaveBeenCalledWith({
        where: { id: 'poll-1', tenantId, status: 'ACTIVE' },
        data: { status: 'CLOSED', closedAt: expect.any(Date) },
      });
    });

    it('400s when nothing matched (already closed or missing)', async () => {
      prisma.poll.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.close(tenantId, 'poll-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('deletes any poll regardless of status', async () => {
      prisma.poll.findFirst.mockResolvedValue({ id: 'poll-1' });
      prisma.poll.delete.mockResolvedValue({});

      await service.remove(tenantId, 'poll-1');

      expect(prisma.poll.delete).toHaveBeenCalledWith({ where: { id: 'poll-1' } });
    });

    it('404s when missing', async () => {
      prisma.poll.findFirst.mockResolvedValue(null);

      await expect(service.remove(tenantId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
