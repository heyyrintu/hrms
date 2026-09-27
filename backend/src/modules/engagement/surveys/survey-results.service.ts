import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SurveyQuestionType, SurveyStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** Below this many responses, an anonymous survey's results stay withheld. */
export const MIN_ANONYMOUS_RESPONSES = 3;

interface QuestionRow {
  id: string;
  type: SurveyQuestionType;
  text: string;
  order: number;
  options: string[];
}

interface AnswerRow {
  id: string;
  questionId: string;
  textValue: string | null;
  choiceValues: string[];
  numericValue: number | null;
}

@Injectable()
export class SurveyResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async results(tenantId: string, id: string) {
    const survey = await this.prisma.survey.findFirst({
      where: { id, tenantId },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!survey) throw new NotFoundException('Survey not found');
    if (survey.status === SurveyStatus.DRAFT) {
      throw new BadRequestException('Results are not available for a draft survey');
    }

    const [participantCount, responseCount] = await Promise.all([
      this.prisma.surveyParticipant.count({ where: { tenantId, surveyId: id } }),
      this.prisma.surveyResponse.count({ where: { tenantId, surveyId: id } }),
    ]);
    const responseRate =
      participantCount === 0 ? 0 : round1(responseCount / participantCount * 100);

    if (survey.isAnonymous && responseCount < MIN_ANONYMOUS_RESPONSES) {
      return {
        surveyId: id,
        isAnonymous: true,
        withheld: true,
        participantCount,
        responseCount,
        responseRate,
      };
    }

    const answers = await this.prisma.surveyAnswer.findMany({
      where: { tenantId, question: { surveyId: id } },
      orderBy: { id: 'asc' },
    });

    const answersByQuestion = new Map<string, AnswerRow[]>();
    for (const answer of answers) {
      const list = answersByQuestion.get(answer.questionId) ?? [];
      list.push(answer);
      answersByQuestion.set(answer.questionId, list);
    }

    const questions = (survey.questions as QuestionRow[]).map((question) =>
      this.aggregateQuestion(question, answersByQuestion.get(question.id) ?? []),
    );

    return {
      surveyId: id,
      isAnonymous: survey.isAnonymous,
      withheld: false,
      participantCount,
      responseCount,
      responseRate,
      questions,
    };
  }

  private aggregateQuestion(question: QuestionRow, answers: AnswerRow[]) {
    const base = { questionId: question.id, text: question.text, type: question.type };

    switch (question.type) {
      case SurveyQuestionType.SINGLE_CHOICE:
      case SurveyQuestionType.MULTI_CHOICE: {
        const counts = new Map(question.options.map((o) => [o, 0]));
        for (const answer of answers) {
          for (const choice of answer.choiceValues) {
            counts.set(choice, (counts.get(choice) ?? 0) + 1);
          }
        }
        return {
          ...base,
          options: question.options.map((option) => ({ option, count: counts.get(option) ?? 0 })),
        };
      }
      case SurveyQuestionType.RATING: {
        const values = answers
          .map((a) => a.numericValue)
          .filter((v): v is number => v !== null);
        const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        for (const v of values) distribution[v] = (distribution[v] ?? 0) + 1;
        const average =
          values.length === 0 ? null : round2(values.reduce((a, b) => a + b, 0) / values.length);
        return { ...base, average, distribution };
      }
      case SurveyQuestionType.ENPS: {
        const values = answers
          .map((a) => a.numericValue)
          .filter((v): v is number => v !== null);
        const promoters = values.filter((v) => v >= 9).length;
        const detractors = values.filter((v) => v <= 6).length;
        const passives = values.length - promoters - detractors;
        const score =
          values.length === 0
            ? null
            : Math.round(((promoters - detractors) / values.length) * 100);
        const distribution: Record<number, number> = {};
        for (let i = 0; i <= 10; i++) distribution[i] = 0;
        for (const v of values) distribution[v] = (distribution[v] ?? 0) + 1;
        return { ...base, promoters, passives, detractors, score, distribution };
      }
      case SurveyQuestionType.TEXT: {
        return {
          ...base,
          answers: answers.map((a) => a.textValue).filter((t): t is string => t !== null),
        };
      }
      default: {
        const unknown: never = question.type;
        throw new Error(`Unknown question type: ${String(unknown)}`);
      }
    }
  }

  async namedResponses(tenantId: string, id: string) {
    const survey = await this.prisma.survey.findFirst({ where: { id, tenantId } });
    if (!survey) throw new NotFoundException('Survey not found');
    if (survey.isAnonymous) {
      throw new BadRequestException('This survey is anonymous; individual responses are not available');
    }

    const responses = await this.prisma.surveyResponse.findMany({
      where: { tenantId, surveyId: id },
      include: { answers: { orderBy: { id: 'asc' } } },
      orderBy: { submittedAt: 'asc' },
    });

    const employeeIds = [...new Set(responses.map((r) => r.employeeId).filter((e): e is string => e !== null))];
    const employees =
      employeeIds.length === 0
        ? []
        : await this.prisma.employee.findMany({
            where: { tenantId, id: { in: employeeIds } },
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
          });
    const employeesById = new Map(employees.map((e) => [e.id, e]));

    return responses.map((response) => ({
      id: response.id,
      submittedAt: response.submittedAt,
      employee: response.employeeId ? employeesById.get(response.employeeId) ?? null : null,
      answers: response.answers,
    }));
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
