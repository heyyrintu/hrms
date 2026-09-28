import { BadRequestException } from '@nestjs/common';
import { SurveyQuestionType } from '@prisma/client';

/** One answer as submitted by a respondent. */
export interface AnswerInput {
  questionId: string;
  text?: string;
  choices?: string[];
  value?: number;
}

/** The subset of `SurveyQuestion` needed to validate an answer against it. */
export interface QuestionForValidation {
  id: string;
  type: SurveyQuestionType;
  required: boolean;
  options: string[];
  text: string;
}

/** A validated answer, shaped exactly like a `SurveyAnswer` row's data. */
export interface NormalizedAnswer {
  questionId: string;
  textValue: string | null;
  choiceValues: string[];
  numericValue: number | null;
}

const MAX_TEXT_LENGTH = 5000;

/**
 * Validates a set of submitted answers against a survey's questions and
 * normalizes them into `SurveyAnswer` row data.
 *
 * Only `TEXT` treats an empty answer as "unanswered" (a blank textarea is a
 * normal submission shape). Every other type must be well-formed when an
 * answer object for it is present at all — an optional question is skipped by
 * omitting it from `answers`, not by sending a malformed empty answer.
 */
export function validateAnswers(
  questions: QuestionForValidation[],
  answers: AnswerInput[],
): NormalizedAnswer[] {
  const questionsById = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const answeredIds = new Set<string>();
  const rows: NormalizedAnswer[] = [];

  for (const answer of answers) {
    const question = questionsById.get(answer.questionId);
    if (!question) {
      throw new BadRequestException(`Unknown question: ${answer.questionId}`);
    }
    if (seen.has(answer.questionId)) {
      throw new BadRequestException(
        `Duplicate answer for question: ${answer.questionId}`,
      );
    }
    seen.add(answer.questionId);

    const row = validateOne(question, answer);
    if (row) {
      rows.push(row);
      answeredIds.add(question.id);
    }
  }

  for (const question of questions) {
    if (question.required && !answeredIds.has(question.id)) {
      throw new BadRequestException(
        `This survey requires an answer to: ${question.text}`,
      );
    }
  }

  return rows;
}

function validateOne(
  question: QuestionForValidation,
  answer: AnswerInput,
): NormalizedAnswer | null {
  const base = {
    questionId: question.id,
    textValue: null as string | null,
    choiceValues: [] as string[],
    numericValue: null as number | null,
  };

  switch (question.type) {
    case SurveyQuestionType.TEXT: {
      const text = (answer.text ?? '').trim();
      if (!text) return null;
      if (text.length > MAX_TEXT_LENGTH) {
        throw new BadRequestException(
          `Answer exceeds ${MAX_TEXT_LENGTH} characters: ${question.text}`,
        );
      }
      return { ...base, textValue: text };
    }
    case SurveyQuestionType.SINGLE_CHOICE: {
      const choices = answer.choices ?? [];
      if (choices.length !== 1 || !question.options.includes(choices[0])) {
        throw new BadRequestException(
          `Select exactly one option for: ${question.text}`,
        );
      }
      return { ...base, choiceValues: choices };
    }
    case SurveyQuestionType.MULTI_CHOICE: {
      const choices = answer.choices ?? [];
      const hasDuplicates = new Set(choices).size !== choices.length;
      const allValid = choices.every((c) => question.options.includes(c));
      if (choices.length === 0 || hasDuplicates || !allValid) {
        throw new BadRequestException(
          `Select valid, non-duplicate options for: ${question.text}`,
        );
      }
      return { ...base, choiceValues: choices };
    }
    case SurveyQuestionType.RATING: {
      const value = answer.value;
      if (
        value === undefined ||
        value === null ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 5
      ) {
        throw new BadRequestException(
          `Rating must be an integer from 1 to 5: ${question.text}`,
        );
      }
      return { ...base, numericValue: value };
    }
    case SurveyQuestionType.ENPS: {
      const value = answer.value;
      if (
        value === undefined ||
        value === null ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 10
      ) {
        throw new BadRequestException(
          `Score must be an integer from 0 to 10: ${question.text}`,
        );
      }
      return { ...base, numericValue: value };
    }
    default: {
      const unknown: never = question.type;
      throw new BadRequestException(`Unknown question type: ${String(unknown)}`);
    }
  }
}
