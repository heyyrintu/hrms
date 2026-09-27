import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SurveyQuestionType, SurveyStatus } from '@prisma/client';
import {
  MIN_ANONYMOUS_RESPONSES,
  SurveyResultsService,
} from './survey-results.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('SurveyResultsService', () => {
  let service: SurveyResultsService;
  let prisma: any;

  const tenantId = 'tenant-1';
  const surveyId = 'survey-1';

  const ratingQuestion = {
    id: 'q-rating',
    type: SurveyQuestionType.RATING,
    text: 'Rate us',
    order: 0,
    options: [],
  };
  const singleQuestion = {
    id: 'q-single',
    type: SurveyQuestionType.SINGLE_CHOICE,
    text: 'Favourite colour?',
    order: 1,
    options: ['Red', 'Green', 'Blue'],
  };
  const enpsQuestion = {
    id: 'q-enps',
    type: SurveyQuestionType.ENPS,
    text: 'Recommend us?',
    order: 2,
    options: [],
  };
  const textQuestion = {
    id: 'q-text',
    type: SurveyQuestionType.TEXT,
    text: 'Anything else?',
    order: 3,
    options: [],
  };

  const surveyWith = (questions: unknown[], overrides: Record<string, unknown> = {}) => ({
    id: surveyId,
    tenantId,
    status: SurveyStatus.ACTIVE,
    isAnonymous: false,
    questions,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SurveyResultsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<SurveyResultsService>(SurveyResultsService);
    prisma.surveyParticipant.count.mockResolvedValue(0);
    prisma.surveyResponse.count.mockResolvedValue(0);
    prisma.surveyAnswer.findMany.mockResolvedValue([]);
  });

  describe('results', () => {
    it('404s a missing survey', async () => {
      prisma.survey.findFirst.mockResolvedValue(null);
      await expect(service.results(tenantId, surveyId)).rejects.toThrow(NotFoundException);
    });

    it('400s a DRAFT survey', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyWith([], { status: SurveyStatus.DRAFT }));
      await expect(service.results(tenantId, surveyId)).rejects.toThrow(BadRequestException);
    });

    it('withholds results for an anonymous survey below the minimum', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyWith([ratingQuestion], { isAnonymous: true }));
      prisma.surveyParticipant.count.mockResolvedValue(10);
      prisma.surveyResponse.count.mockResolvedValue(MIN_ANONYMOUS_RESPONSES - 1);

      const result = await service.results(tenantId, surveyId);

      expect(result).toEqual({
        surveyId,
        isAnonymous: true,
        withheld: true,
        participantCount: 10,
        responseCount: 2,
        responseRate: 20,
      });
    });

    it('shows results for an anonymous survey once the minimum is met', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyWith([ratingQuestion], { isAnonymous: true }));
      prisma.surveyParticipant.count.mockResolvedValue(10);
      prisma.surveyResponse.count.mockResolvedValue(MIN_ANONYMOUS_RESPONSES);

      const result = await service.results(tenantId, surveyId);

      expect(result.withheld).toBe(false);
      expect(result).toHaveProperty('questions');
    });

    it('computes the eNPS score from promoters/passives/detractors', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyWith([enpsQuestion]));
      prisma.surveyParticipant.count.mockResolvedValue(10);
      prisma.surveyResponse.count.mockResolvedValue(10);
      const values = [9, 9, 9, 9, 9, 7, 8, 3, 4, 5]; // 5 promoters, 2 passives, 3 detractors
      prisma.surveyAnswer.findMany.mockResolvedValue(
        values.map((v, i) => ({
          id: `a-${i}`,
          questionId: 'q-enps',
          textValue: null,
          choiceValues: [],
          numericValue: v,
        })),
      );

      const result = await service.results(tenantId, surveyId);
      const q: any = (result as any).questions.find((r: any) => r.questionId === 'q-enps');

      expect(q.promoters).toBe(5);
      expect(q.passives).toBe(2);
      expect(q.detractors).toBe(3);
      expect(q.score).toBe(20);
    });

    it('computes the RATING average (2dp) and 1..5 distribution', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyWith([ratingQuestion]));
      prisma.surveyParticipant.count.mockResolvedValue(3);
      prisma.surveyResponse.count.mockResolvedValue(3);
      prisma.surveyAnswer.findMany.mockResolvedValue([
        { id: 'a-1', questionId: 'q-rating', textValue: null, choiceValues: [], numericValue: 4 },
        { id: 'a-2', questionId: 'q-rating', textValue: null, choiceValues: [], numericValue: 5 },
        { id: 'a-3', questionId: 'q-rating', textValue: null, choiceValues: [], numericValue: 4 },
      ]);

      const result = await service.results(tenantId, surveyId);
      const q: any = (result as any).questions.find((r: any) => r.questionId === 'q-rating');

      expect(q.average).toBe(4.33);
      expect(q.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
    });

    it('counts choices in option order with zeros for unpicked options', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyWith([singleQuestion]));
      prisma.surveyParticipant.count.mockResolvedValue(2);
      prisma.surveyResponse.count.mockResolvedValue(2);
      prisma.surveyAnswer.findMany.mockResolvedValue([
        { id: 'a-1', questionId: 'q-single', textValue: null, choiceValues: ['Green'], numericValue: null },
        { id: 'a-2', questionId: 'q-single', textValue: null, choiceValues: ['Green'], numericValue: null },
      ]);

      const result = await service.results(tenantId, surveyId);
      const q: any = (result as any).questions.find((r: any) => r.questionId === 'q-single');

      expect(q.options).toEqual([
        { option: 'Red', count: 0 },
        { option: 'Green', count: 2 },
        { option: 'Blue', count: 0 },
      ]);
    });

    it('orders TEXT answers by answer id, not insertion order', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyWith([textQuestion]));
      prisma.surveyParticipant.count.mockResolvedValue(2);
      prisma.surveyResponse.count.mockResolvedValue(2);
      prisma.surveyAnswer.findMany.mockResolvedValue([
        { id: 'a-1', questionId: 'q-text', textValue: 'first', choiceValues: [], numericValue: null },
        { id: 'a-2', questionId: 'q-text', textValue: 'second', choiceValues: [], numericValue: null },
      ]);

      await service.results(tenantId, surveyId);

      expect(prisma.surveyAnswer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { id: 'asc' } }),
      );
    });

    it('reports a 1dp responseRate, 0 when there are no responses', async () => {
      prisma.survey.findFirst.mockResolvedValue(surveyWith([ratingQuestion]));
      prisma.surveyParticipant.count.mockResolvedValue(0);
      prisma.surveyResponse.count.mockResolvedValue(0);

      const result = await service.results(tenantId, surveyId);

      expect(result.responseRate).toBe(0);
    });
  });

  describe('namedResponses', () => {
    it('400s an anonymous survey', async () => {
      prisma.survey.findFirst.mockResolvedValue({ id: surveyId, tenantId, isAnonymous: true });
      await expect(service.namedResponses(tenantId, surveyId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('joins responses to employees by id (no relation)', async () => {
      prisma.survey.findFirst.mockResolvedValue({ id: surveyId, tenantId, isAnonymous: false });
      prisma.surveyResponse.findMany.mockResolvedValue([
        { id: 'r-1', employeeId: 'emp-1', submittedAt: new Date(), answers: [] },
      ]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', firstName: 'Asha', lastName: 'Rao', employeeCode: 'E001' },
      ]);

      const result = await service.namedResponses(tenantId, surveyId);

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId, id: { in: ['emp-1'] } },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
      });
      expect(result[0].employee).toEqual({
        id: 'emp-1',
        firstName: 'Asha',
        lastName: 'Rao',
        employeeCode: 'E001',
      });
    });
  });
});
