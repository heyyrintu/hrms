import { Test, TestingModule } from '@nestjs/testing';
import { PollReleaseService, POLL_RELEASE_BATCH_MIN } from './poll-release.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('PollReleaseService', () => {
  let service: PollReleaseService;
  let prisma: any;
  let encryption: { decrypt: jest.Mock };

  const tenantId = 'tenant-1';
  const pollId = 'poll-1';

  const pending = (id: string, optionId: string) => ({ id, payload: `cipher:${optionId}` });

  function givePending(rows: { id: string; payload: string }[]) {
    prisma.$queryRaw.mockResolvedValue(rows.map((r) => ({ id: r.id })));
    prisma.pollPendingVote.findMany.mockResolvedValue(rows);
  }

  beforeEach(async () => {
    prisma = createMockPrismaService();
    encryption = { decrypt: jest.fn((v: string) => v.replace(/^cipher:/, '')) };
    prisma.pollOption.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollReleaseService,
        { provide: PrismaService, useValue: prisma },
        { provide: FieldEncryptionService, useValue: encryption },
      ],
    }).compile();
    service = module.get(PollReleaseService);
  });

  it('uses a batch minimum of 3', () => {
    expect(POLL_RELEASE_BATCH_MIN).toBe(3);
  });

  it('locks pending votes with FOR UPDATE SKIP LOCKED scoped by poll and tenant', async () => {
    givePending([]);
    await service.release(tenantId, pollId, { force: false });

    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');
    expect(sql).toContain('FROM poll_pending_votes');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(values).toEqual([pollId, tenantId]);
  });

  it('applies nothing when fewer than 3 are pending and force is false', async () => {
    givePending([pending('v1', 'opt-a'), pending('v2', 'opt-b')]);

    await expect(service.release(tenantId, pollId, { force: false })).resolves.toBe(0);

    expect(prisma.pollOption.updateMany).not.toHaveBeenCalled();
    expect(prisma.pollPendingVote.deleteMany).not.toHaveBeenCalled();
  });

  it('applies a batch of 3 grouped per option and deletes the pending votes', async () => {
    givePending([pending('v1', 'opt-a'), pending('v2', 'opt-b'), pending('v3', 'opt-a')]);

    await expect(service.release(tenantId, pollId, { force: false })).resolves.toBe(3);

    expect(prisma.pollOption.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.pollOption.updateMany).toHaveBeenCalledWith({
      where: { id: 'opt-a', pollId, tenantId },
      data: { voteCount: { increment: 2 } },
    });
    expect(prisma.pollOption.updateMany).toHaveBeenCalledWith({
      where: { id: 'opt-b', pollId, tenantId },
      data: { voteCount: { increment: 1 } },
    });
    expect(prisma.pollPendingVote.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, pollId, id: { in: ['v1', 'v2', 'v3'] } },
    });
  });

  it('never touches voter rows in the release transaction', async () => {
    givePending([pending('v1', 'opt-a'), pending('v2', 'opt-b'), pending('v3', 'opt-a')]);

    await service.release(tenantId, pollId, { force: false });

    for (const fn of Object.values(prisma.pollVoter) as jest.Mock[]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('force applies a single pending vote', async () => {
    givePending([pending('v1', 'opt-a')]);

    await expect(service.release(tenantId, pollId, { force: true })).resolves.toBe(1);

    expect(prisma.pollOption.updateMany).toHaveBeenCalledWith({
      where: { id: 'opt-a', pollId, tenantId },
      data: { voteCount: { increment: 1 } },
    });
  });

  it('returns 0 without writing when nothing is pending, even when forced', async () => {
    givePending([]);

    await expect(service.release(tenantId, pollId, { force: true })).resolves.toBe(0);

    expect(prisma.pollPendingVote.findMany).not.toHaveBeenCalled();
    expect(prisma.pollOption.updateMany).not.toHaveBeenCalled();
  });

  it('decrypts every payload through FieldEncryptionService', async () => {
    givePending([pending('v1', 'opt-a'), pending('v2', 'opt-b'), pending('v3', 'opt-a')]);

    await service.release(tenantId, pollId, { force: false });

    expect(encryption.decrypt).toHaveBeenCalledTimes(3);
  });
});
