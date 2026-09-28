import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';

/** Pending votes are applied only in batches of at least this many, unless forced. */
export const POLL_RELEASE_BATCH_MIN = 3;

/**
 * Applies buffered votes from `poll_pending_votes` to `poll_options.voteCount`.
 *
 * Why a buffer: a PostgreSQL row version records the id of the transaction
 * that wrote it (`xmin`). If the vote transaction both inserted the voter's
 * `PollVoter` row and incremented the option, the option row's `xmin` would
 * name its most recent voter. The vote transaction therefore writes only an
 * encrypted pending row; this release runs in its own transaction, touches no
 * voter rows, and applies at least 3 votes at once, so an option's `xmin`
 * matches no voter.
 */
@Injectable()
export class PollReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  /** Returns how many votes were applied (0 when below the batch minimum). */
  async release(
    tenantId: string,
    pollId: string,
    options: { force: boolean },
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM poll_pending_votes
        WHERE "pollId" = ${pollId} AND "tenantId" = ${tenantId}
        FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return 0;
      if (locked.length < POLL_RELEASE_BATCH_MIN && !options.force) return 0;

      const pending = await tx.pollPendingVote.findMany({
        where: { tenantId, pollId, id: { in: locked.map((row) => row.id) } },
        select: { id: true, payload: true },
      });

      const perOption = new Map<string, number>();
      for (const row of pending) {
        const optionId = this.fieldEncryption.decrypt(row.payload);
        perOption.set(optionId, (perOption.get(optionId) ?? 0) + 1);
      }

      // Sorted so concurrent releases on the same poll lock options in one order.
      for (const optionId of [...perOption.keys()].sort()) {
        await tx.pollOption.updateMany({
          where: { id: optionId, pollId, tenantId },
          data: { voteCount: { increment: perOption.get(optionId) as number } },
        });
      }

      await tx.pollPendingVote.deleteMany({
        where: { tenantId, pollId, id: { in: pending.map((row) => row.id) } },
      });

      return pending.length;
    });
  }
}
