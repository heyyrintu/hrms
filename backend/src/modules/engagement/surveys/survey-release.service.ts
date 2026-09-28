import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { unpadPayload } from './pending-payload';

/**
 * Pending anonymous responses are only released once at least this many are
 * waiting (unless forced on close / by the cron for a closed survey), so a
 * released batch never maps to a single respondent.
 */
export const RELEASE_BATCH_MIN = 3;

/** One normalised answer, as produced by `validateAnswers`. */
export interface PendingAnswerRow {
  questionId: string;
  textValue: string | null;
  choiceValues: string[];
  numericValue: number | null;
}

/** In-place Fisher-Yates shuffle driven by a CSPRNG. */
export function secureShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Moves anonymous submissions from `survey_pending_responses` into
 * `survey_responses` / `survey_answers`.
 *
 * Why a buffer: every row version in PostgreSQL carries the id of the
 * transaction that wrote it (`xmin`). If the participant flag (which names the
 * employee) and the response were written in the same transaction, anyone
 * with SELECT could join them on `xmin`. The submit transaction therefore
 * writes only an encrypted pending row; this release runs in its own
 * transaction, touches NO participant rows, and inserts a shuffled batch of
 * several responses, so every released row shares one `xmin` that matches no
 * participant and the physical order says nothing about who submitted first.
 */
@Injectable()
export class SurveyReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  /** Returns how many responses were released (0 when below the batch minimum). */
  async release(
    tenantId: string,
    surveyId: string,
    options: { force: boolean },
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM survey_pending_responses
        WHERE "surveyId" = ${surveyId} AND "tenantId" = ${tenantId}
        FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return 0;
      if (locked.length < RELEASE_BATCH_MIN && !options.force) return 0;

      const ids = locked.map((row) => row.id);
      const pending = await tx.surveyPendingResponse.findMany({
        where: { tenantId, surveyId, id: { in: ids } },
        select: { id: true, payload: true },
      });

      const submissions = secureShuffle(
        pending.map(
          (row) =>
            JSON.parse(
              unpadPayload(this.fieldEncryption.decrypt(row.payload)),
            ) as PendingAnswerRow[],
        ),
      );

      for (const rows of submissions) {
        const response = await tx.surveyResponse.create({
          data: { tenantId, surveyId, employeeId: null, submittedAt: null },
          select: { id: true },
        });
        if (rows.length > 0) {
          await tx.surveyAnswer.createMany({
            data: rows.map((r) => ({ tenantId, responseId: response.id, ...r })),
          });
        }
      }

      await tx.surveyPendingResponse.deleteMany({
        where: { tenantId, surveyId, id: { in: pending.map((row) => row.id) } },
      });

      return pending.length;
    });
  }
}
