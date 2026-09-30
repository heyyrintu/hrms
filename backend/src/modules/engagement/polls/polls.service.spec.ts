import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PollsService } from './polls.service';
import { PollReleaseService } from './poll-release.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('PollsService', () => {
  let service: PollsService;
  let prisma: any;
  let encryption: { encrypt: jest.Mock };
  let release: { release: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';

  beforeEach(async () => {
    encryption = { encrypt: jest.fn((plain: string) => `cipher:${plain}`) };
    release = { release: jest.fn().mockResolvedValue(0) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: FieldEncryptionService, useValue: encryption },
        { provide: PollReleaseService, useValue: release },
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

    it('reports pendingVotes alongside applied counts once counts are visible', async () => {
      prisma.poll.findMany.mockResolvedValue([
        {
          id: 'poll-1',
          question: 'Q?',
          closesAt: null,
          createdAt: now,
          options: [{ id: 'opt-1', order: 0, label: 'A', voteCount: 3 }],
          _count: { pending: 2 },
        },
      ]);
      prisma.pollVoter.findMany.mockResolvedValue([{ pollId: 'poll-1' }]);

      const result = await service.active(tenantId, employeeId, false);

      expect(prisma.poll.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ _count: { select: { pending: true } } }),
        }),
      );
      expect(result[0].totalVotes).toBe(3);
      expect(result[0].pendingVotes).toBe(2);
    });

    it('hides pendingVotes from a caller who cannot see counts', async () => {
      prisma.poll.findMany.mockResolvedValue([
        {
          id: 'poll-1',
          question: 'Q?',
          closesAt: null,
          createdAt: now,
          options: [{ id: 'opt-1', order: 0, label: 'A', voteCount: 3 }],
          _count: { pending: 2 },
        },
      ]);
      prisma.pollVoter.findMany.mockResolvedValue([]);

      const result = await service.active(tenantId, employeeId, false);

      expect(result[0].pendingVotes).toBeNull();
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

  describe('recentClosed', () => {
    const now = new Date('2026-03-15T12:00:00Z');
    const DAY = 24 * 60 * 60 * 1000;

    const row = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      question: `Q ${id}`,
      status: 'CLOSED',
      closedAt: new Date(now.getTime() - DAY),
      closesAt: null,
      createdAt: new Date(now.getTime() - 5 * DAY),
      options: [
        { id: `${id}-a`, order: 0, label: 'A', voteCount: 3 },
        { id: `${id}-b`, order: 1, label: 'B', voteCount: 1 },
      ],
      _count: { pending: 2 },
      ...over,
    });

    beforeEach(() => jest.useFakeTimers().setSystemTime(now));
    afterEach(() => jest.useRealTimers());

    it('scopes to the tenant and a 30-day window for CLOSED and expired-ACTIVE polls', async () => {
      prisma.poll.findMany.mockResolvedValue([]);

      await service.recentClosed(tenantId);

      const cutoff = new Date(now.getTime() - 30 * DAY);
      expect(prisma.poll.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            OR: [
              { status: 'CLOSED', closedAt: { gte: cutoff } },
              { status: 'ACTIVE', closesAt: { gte: cutoff, lte: now } },
            ],
          },
        }),
      );
    });

    it('does not query voters', async () => {
      prisma.poll.findMany.mockResolvedValue([row('p1')]);

      await service.recentClosed(tenantId);

      expect(prisma.pollVoter.findMany).not.toHaveBeenCalled();
    });

    it('returns released counts, total and pending votes, always visible', async () => {
      prisma.poll.findMany.mockResolvedValue([row('p1')]);

      const result = await service.recentClosed(tenantId);

      expect(result).toEqual([
        {
          id: 'p1',
          question: 'Q p1',
          closedAt: new Date(now.getTime() - DAY),
          totalVotes: 4,
          pendingVotes: 2,
          options: [
            { id: 'p1-a', order: 0, label: 'A', voteCount: 3 },
            { id: 'p1-b', order: 1, label: 'B', voteCount: 1 },
          ],
        },
      ]);
    });

    it('orders newest first by closedAt, falling back to closesAt for expired ACTIVE polls', async () => {
      prisma.poll.findMany.mockResolvedValue([
        row('old-closed', { closedAt: new Date(now.getTime() - 10 * DAY) }),
        row('expired-active', {
          status: 'ACTIVE',
          closedAt: null,
          closesAt: new Date(now.getTime() - 2 * DAY),
        }),
        row('new-closed', { closedAt: new Date(now.getTime() - 1 * DAY) }),
      ]);

      const result = await service.recentClosed(tenantId);

      expect(result.map((p) => p.id)).toEqual(['new-closed', 'expired-active', 'old-closed']);
      expect(result[1].closedAt).toEqual(new Date(now.getTime() - 2 * DAY));
    });

    it('returns at most 5 polls', async () => {
      prisma.poll.findMany.mockResolvedValue(
        Array.from({ length: 8 }, (_, i) =>
          row(`p${i}`, { closedAt: new Date(now.getTime() - (i + 1) * DAY) }),
        ),
      );

      const result = await service.recentClosed(tenantId);

      expect(result).toHaveLength(5);
      expect(result.map((p) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    });

    it('returns an empty list when nothing closed recently', async () => {
      prisma.poll.findMany.mockResolvedValue([]);

      await expect(service.recentClosed(tenantId)).resolves.toEqual([]);
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

    it('votes: creates the voter row and an encrypted pending vote, no option write', async () => {
      prisma.poll.findFirst.mockResolvedValue(activePoll);
      prisma.pollVoter.create.mockResolvedValue({ id: 'voter-1' });

      await service.vote(tenantId, 'poll-1', employeeId, { optionId: 'opt-a' });

      expect(prisma.pollVoter.create).toHaveBeenCalledWith({
        data: { tenantId, pollId: 'poll-1', employeeId },
      });
      expect(encryption.encrypt).toHaveBeenCalledWith('opt-a');
      expect(prisma.pollPendingVote.create).toHaveBeenCalledWith({
        data: { tenantId, pollId: 'poll-1', payload: 'cipher:opt-a' },
        select: { id: true },
      });
      expect(prisma.pollOption.update).not.toHaveBeenCalled();
      expect(prisma.pollOption.updateMany).not.toHaveBeenCalled();
    });

    it('triggers a non-forced release after the vote commits', async () => {
      prisma.poll.findFirst.mockResolvedValue(activePoll);
      prisma.pollVoter.create.mockResolvedValue({ id: 'voter-1' });

      await service.vote(tenantId, 'poll-1', employeeId, { optionId: 'opt-a' });

      expect(release.release).toHaveBeenCalledWith(tenantId, 'poll-1', { force: false });
    });

    it('still succeeds when the release fails', async () => {
      prisma.poll.findFirst.mockResolvedValue(activePoll);
      prisma.pollVoter.create.mockResolvedValue({ id: 'voter-1' });
      release.release.mockRejectedValue(new Error('db blip'));

      await expect(
        service.vote(tenantId, 'poll-1', employeeId, { optionId: 'opt-a' }),
      ).resolves.toEqual({ success: true });
    });

    it('fails before any write when the encryption key is missing', async () => {
      prisma.poll.findFirst.mockResolvedValue(activePoll);
      encryption.encrypt.mockImplementation(() => {
        throw new InternalServerErrorException('FIELD_ENCRYPTION_KEY is not configured');
      });

      await expect(
        service.vote(tenantId, 'poll-1', employeeId, { optionId: 'opt-a' }),
      ).rejects.toThrow(InternalServerErrorException);
      expect(prisma.pollVoter.create).not.toHaveBeenCalled();
      expect(prisma.pollPendingVote.create).not.toHaveBeenCalled();
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
      expect(prisma.pollPendingVote.create).not.toHaveBeenCalled();
      expect(release.release).not.toHaveBeenCalled();
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
      expect(release.release).not.toHaveBeenCalled();
    });

    it('force-applies pending votes after the close commits', async () => {
      prisma.poll.updateMany.mockResolvedValue({ count: 1 });

      await service.close(tenantId, 'poll-1');

      expect(release.release).toHaveBeenCalledWith(tenantId, 'poll-1', { force: true });
    });

    it('still closes when the release fails (the cron retries it)', async () => {
      prisma.poll.updateMany.mockResolvedValue({ count: 1 });
      release.release.mockRejectedValue(new Error('db blip'));

      await expect(service.close(tenantId, 'poll-1')).resolves.toEqual({ success: true });
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
