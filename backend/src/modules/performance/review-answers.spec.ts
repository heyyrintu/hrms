import { BadRequestException } from '@nestjs/common';
import { validateAnswers } from './review-answers';

const questions = [
  { id: 'q-self-rating', type: 'RATING', audience: 'SELF', isRequired: true },
  { id: 'q-self-text', type: 'TEXT', audience: 'SELF', isRequired: false },
  { id: 'q-mgr-rating', type: 'RATING', audience: 'MANAGER', isRequired: true },
  { id: 'q-peer-text', type: 'TEXT', audience: 'PEER', isRequired: true },
] as any[];

describe('validateAnswers', () => {
  it('returns rows for a valid answer set (optional question skipped)', () => {
    const rows = validateAnswers(
      questions,
      [{ cycleQuestionId: 'q-self-rating', rating: 4 }],
      'SELF' as any,
    );
    expect(rows).toEqual([
      { cycleQuestionId: 'q-self-rating', audience: 'SELF', rating: 4, text: null },
    ]);
  });

  it('trims TEXT answers and nulls the rating', () => {
    const rows = validateAnswers(
      questions,
      [
        { cycleQuestionId: 'q-self-rating', rating: 5 },
        { cycleQuestionId: 'q-self-text', text: '  great  ' },
      ],
      'SELF' as any,
    );
    expect(rows[1]).toEqual({ cycleQuestionId: 'q-self-text', audience: 'SELF', rating: null, text: 'great' });
  });

  it('treats undefined answers as empty and fails when something is required', () => {
    expect(() => validateAnswers(questions, undefined, 'SELF' as any)).toThrow(
      'Please answer every required question',
    );
  });

  it('passes with no answers when the audience has no required questions', () => {
    expect(validateAnswers(questions.filter((q) => q.audience !== 'SELF'), [], 'SELF' as any)).toEqual([]);
  });

  it('rejects an unknown cycleQuestionId', () => {
    expect(() =>
      validateAnswers(questions, [{ cycleQuestionId: 'nope', rating: 3 }], 'SELF' as any),
    ).toThrow(BadRequestException);
  });

  it('rejects an answer to another audience question', () => {
    expect(() =>
      validateAnswers(
        questions,
        [
          { cycleQuestionId: 'q-self-rating', rating: 3 },
          { cycleQuestionId: 'q-mgr-rating', rating: 3 },
        ],
        'SELF' as any,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects duplicate answers to the same question', () => {
    expect(() =>
      validateAnswers(
        questions,
        [
          { cycleQuestionId: 'q-self-rating', rating: 3 },
          { cycleQuestionId: 'q-self-rating', rating: 4 },
        ],
        'SELF' as any,
      ),
    ).toThrow(/duplicate/i);
  });

  it.each([0, 6, 2.5, '3' as any, null as any])('rejects RATING value %p', (rating) => {
    expect(() =>
      validateAnswers(questions, [{ cycleQuestionId: 'q-self-rating', rating }], 'SELF' as any),
    ).toThrow(BadRequestException);
  });

  it('rejects text on a RATING question', () => {
    expect(() =>
      validateAnswers(questions, [{ cycleQuestionId: 'q-self-rating', rating: 3, text: 'x' }], 'SELF' as any),
    ).toThrow(BadRequestException);
  });

  it('rejects a rating on a TEXT question', () => {
    expect(() =>
      validateAnswers(
        questions,
        [
          { cycleQuestionId: 'q-self-rating', rating: 3 },
          { cycleQuestionId: 'q-self-text', rating: 3 },
        ],
        'SELF' as any,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects blank and over-long TEXT answers', () => {
    const base = { cycleQuestionId: 'q-self-rating', rating: 3 };
    expect(() =>
      validateAnswers(questions, [base, { cycleQuestionId: 'q-self-text', text: '   ' }], 'SELF' as any),
    ).toThrow(BadRequestException);
    expect(() =>
      validateAnswers(questions, [base, { cycleQuestionId: 'q-self-text', text: 'a'.repeat(5001) }], 'SELF' as any),
    ).toThrow(BadRequestException);
    expect(
      validateAnswers(questions, [base, { cycleQuestionId: 'q-self-text', text: 'a'.repeat(5000) }], 'SELF' as any),
    ).toHaveLength(2);
  });

  it('validates PEER answers against PEER questions only', () => {
    const rows = validateAnswers(questions, [{ cycleQuestionId: 'q-peer-text', text: 'helpful' }], 'PEER' as any);
    expect(rows).toEqual([{ cycleQuestionId: 'q-peer-text', audience: 'PEER', rating: null, text: 'helpful' }]);
    expect(() => validateAnswers(questions, [], 'PEER' as any)).toThrow(
      'Please answer every required question',
    );
  });
});
