import { BadRequestException } from '@nestjs/common';
import { SurveyQuestionType } from '@prisma/client';
import {
  QuestionForValidation,
  validateAnswers,
} from './survey-answer-validation';

describe('validateAnswers', () => {
  const textQ = (overrides: Partial<QuestionForValidation> = {}): QuestionForValidation => ({
    id: 'q-text',
    type: SurveyQuestionType.TEXT,
    required: true,
    options: [],
    text: 'How do you feel?',
    ...overrides,
  });

  const singleQ = (overrides: Partial<QuestionForValidation> = {}): QuestionForValidation => ({
    id: 'q-single',
    type: SurveyQuestionType.SINGLE_CHOICE,
    required: true,
    options: ['Red', 'Green', 'Blue'],
    text: 'Favourite colour?',
    ...overrides,
  });

  const multiQ = (overrides: Partial<QuestionForValidation> = {}): QuestionForValidation => ({
    id: 'q-multi',
    type: SurveyQuestionType.MULTI_CHOICE,
    required: true,
    options: ['A', 'B', 'C'],
    text: 'Pick some?',
    ...overrides,
  });

  const ratingQ = (overrides: Partial<QuestionForValidation> = {}): QuestionForValidation => ({
    id: 'q-rating',
    type: SurveyQuestionType.RATING,
    required: true,
    options: [],
    text: 'Rate us',
    ...overrides,
  });

  const enpsQ = (overrides: Partial<QuestionForValidation> = {}): QuestionForValidation => ({
    id: 'q-enps',
    type: SurveyQuestionType.ENPS,
    required: true,
    options: [],
    text: 'Recommend us?',
    ...overrides,
  });

  it('throws for an unknown questionId', () => {
    expect(() =>
      validateAnswers([textQ()], [{ questionId: 'ghost', text: 'hi' }]),
    ).toThrow(BadRequestException);
  });

  it('throws for a duplicate questionId', () => {
    expect(() =>
      validateAnswers(
        [textQ({ required: false })],
        [
          { questionId: 'q-text', text: 'first' },
          { questionId: 'q-text', text: 'second' },
        ],
      ),
    ).toThrow(BadRequestException);
  });

  it('throws when a required question is missing', () => {
    expect(() => validateAnswers([textQ()], [])).toThrow(BadRequestException);
  });

  it('treats a trimmed-empty TEXT answer as missing', () => {
    expect(() =>
      validateAnswers([textQ()], [{ questionId: 'q-text', text: '   ' }]),
    ).toThrow(BadRequestException);
  });

  it('skips an unanswered optional question with no row', () => {
    const rows = validateAnswers([textQ({ required: false })], []);
    expect(rows).toEqual([]);
  });

  it('rejects a SINGLE_CHOICE answer that is not exactly one listed option', () => {
    expect(() =>
      validateAnswers([singleQ()], [{ questionId: 'q-single', choices: ['Purple'] }]),
    ).toThrow(BadRequestException);
    expect(() =>
      validateAnswers(
        [singleQ()],
        [{ questionId: 'q-single', choices: ['Red', 'Green'] }],
      ),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid SINGLE_CHOICE answer', () => {
    const rows = validateAnswers(
      [singleQ()],
      [{ questionId: 'q-single', choices: ['Green'] }],
    );
    expect(rows).toEqual([
      { questionId: 'q-single', textValue: null, choiceValues: ['Green'], numericValue: null },
    ]);
  });

  it('rejects an empty MULTI_CHOICE answer', () => {
    expect(() =>
      validateAnswers([multiQ()], [{ questionId: 'q-multi', choices: [] }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a MULTI_CHOICE answer with an unlisted option', () => {
    expect(() =>
      validateAnswers([multiQ()], [{ questionId: 'q-multi', choices: ['Z'] }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a MULTI_CHOICE answer with a duplicate option', () => {
    expect(() =>
      validateAnswers([multiQ()], [{ questionId: 'q-multi', choices: ['A', 'A'] }]),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid MULTI_CHOICE answer', () => {
    const rows = validateAnswers(
      [multiQ()],
      [{ questionId: 'q-multi', choices: ['A', 'C'] }],
    );
    expect(rows).toEqual([
      { questionId: 'q-multi', textValue: null, choiceValues: ['A', 'C'], numericValue: null },
    ]);
  });

  it('rejects a RATING that is not an integer 1-5', () => {
    expect(() =>
      validateAnswers([ratingQ()], [{ questionId: 'q-rating', value: 0 }]),
    ).toThrow(BadRequestException);
    expect(() =>
      validateAnswers([ratingQ()], [{ questionId: 'q-rating', value: 6 }]),
    ).toThrow(BadRequestException);
    expect(() =>
      validateAnswers([ratingQ()], [{ questionId: 'q-rating', value: 3.5 }]),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid RATING', () => {
    const rows = validateAnswers([ratingQ()], [{ questionId: 'q-rating', value: 4 }]);
    expect(rows).toEqual([
      { questionId: 'q-rating', textValue: null, choiceValues: [], numericValue: 4 },
    ]);
  });

  it('rejects an ENPS that is not an integer 0-10', () => {
    expect(() =>
      validateAnswers([enpsQ()], [{ questionId: 'q-enps', value: -1 }]),
    ).toThrow(BadRequestException);
    expect(() =>
      validateAnswers([enpsQ()], [{ questionId: 'q-enps', value: 11 }]),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid ENPS', () => {
    const rows = validateAnswers([enpsQ()], [{ questionId: 'q-enps', value: 9 }]);
    expect(rows).toEqual([
      { questionId: 'q-enps', textValue: null, choiceValues: [], numericValue: 9 },
    ]);
  });

  it('rejects a TEXT answer over 5000 characters', () => {
    expect(() =>
      validateAnswers(
        [textQ()],
        [{ questionId: 'q-text', text: 'a'.repeat(5001) }],
      ),
    ).toThrow(BadRequestException);
  });

  it('accepts and trims a valid TEXT answer', () => {
    const rows = validateAnswers(
      [textQ()],
      [{ questionId: 'q-text', text: '  great  ' }],
    );
    expect(rows).toEqual([
      { questionId: 'q-text', textValue: 'great', choiceValues: [], numericValue: null },
    ]);
  });
});
