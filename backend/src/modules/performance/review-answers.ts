import { BadRequestException } from '@nestjs/common';
import { ReviewAudience } from '@prisma/client';

export interface CycleQuestionLike {
  id: string;
  type: 'RATING' | 'TEXT' | string;
  audience: ReviewAudience | string;
  isRequired: boolean;
}

export interface AnswerInputLike {
  cycleQuestionId: string;
  rating?: number | null;
  text?: string | null;
}

export interface ValidatedAnswerRow {
  cycleQuestionId: string;
  audience: ReviewAudience;
  rating: number | null;
  text: string | null;
}

const MAX_TEXT = 5000;

/**
 * Validates one respondent's answers against the cycle's question snapshot
 * for `audience`. Used by self, manager and peer submits. Returns rows ready
 * for `reviewAnswer.createMany` (peer submit drops `audience`).
 */
export function validateAnswers(
  questions: CycleQuestionLike[],
  answers: AnswerInputLike[] | undefined,
  audience: ReviewAudience | string,
): ValidatedAnswerRow[] {
  const allowed = new Map(
    questions.filter((q) => q.audience === audience).map((q) => [q.id, q]),
  );
  const seen = new Set<string>();
  const rows: ValidatedAnswerRow[] = [];

  for (const a of answers ?? []) {
    const q = allowed.get(a.cycleQuestionId);
    if (!q) {
      throw new BadRequestException(`Unknown question: ${a.cycleQuestionId}`);
    }
    if (seen.has(q.id)) {
      throw new BadRequestException(`Duplicate answer for question: ${q.id}`);
    }
    seen.add(q.id);

    if (q.type === 'RATING') {
      if (
        typeof a.rating !== 'number' ||
        !Number.isInteger(a.rating) ||
        a.rating < 1 ||
        a.rating > 5
      ) {
        throw new BadRequestException('Rating answers must be a whole number from 1 to 5');
      }
      if (a.text !== undefined && a.text !== null) {
        throw new BadRequestException('Rating questions do not accept text');
      }
      rows.push({ cycleQuestionId: q.id, audience: audience as ReviewAudience, rating: a.rating, text: null });
    } else {
      if (a.rating !== undefined && a.rating !== null) {
        throw new BadRequestException('Text questions do not accept a rating');
      }
      const text = typeof a.text === 'string' ? a.text.trim() : '';
      if (text.length < 1 || text.length > MAX_TEXT) {
        throw new BadRequestException(`Text answers must be 1 to ${MAX_TEXT} characters`);
      }
      rows.push({ cycleQuestionId: q.id, audience: audience as ReviewAudience, rating: null, text });
    }
  }

  for (const q of allowed.values()) {
    if (q.isRequired && !seen.has(q.id)) {
      throw new BadRequestException('Please answer every required question');
    }
  }

  return rows;
}
