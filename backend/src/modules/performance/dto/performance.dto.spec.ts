import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateReviewCycleDto,
  SetPotentialDto,
  SubmitManagerReviewDto,
  SubmitSelfReviewDto,
  UpdateReviewCycleDto,
} from './performance.dto';
import { CreateTemplateDto, CreateQuestionDto } from '../templates/dto/templates.dto';
import { AddPeerDto, SubmitPeerFeedbackDto } from '../peer-reviews/dto/peer-reviews.dto';

const UUID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('performance DTOs', () => {
  describe('cycle DTOs', () => {
    const base = { name: 'Q1', startDate: '2026-01-01', endDate: '2026-03-31' };

    it('accept template, peer toggle and maxPeers 1-10', async () => {
      expect(await errorsOf(CreateReviewCycleDto, { ...base, templateId: UUID, peerFeedbackEnabled: true, maxPeers: 10 })).toEqual([]);
      expect(await errorsOf(CreateReviewCycleDto, { ...base, maxPeers: 1 })).toEqual([]);
    });

    it.each([0, 11, 2.5])('reject maxPeers %p', async (maxPeers) => {
      expect(await errorsOf(CreateReviewCycleDto, { ...base, maxPeers })).toEqual(['maxPeers']);
      expect(await errorsOf(UpdateReviewCycleDto, { maxPeers })).toEqual(['maxPeers']);
    });

    it('reject a non-UUID templateId but allow null (clears it)', async () => {
      expect(await errorsOf(CreateReviewCycleDto, { ...base, templateId: 'nope' })).toEqual(['templateId']);
      expect(await errorsOf(UpdateReviewCycleDto, { templateId: null })).toEqual([]);
    });
  });

  describe('review DTOs', () => {
    it('self review validates nested answers', async () => {
      expect(
        await errorsOf(SubmitSelfReviewDto, { selfRating: 4, answers: [{ cycleQuestionId: UUID, rating: 5 }] }),
      ).toEqual([]);
      expect(
        await errorsOf(SubmitSelfReviewDto, { selfRating: 4, answers: [{ cycleQuestionId: 'x', rating: 9 }] }),
      ).toEqual(['answers']);
    });

    it('manager review validates potential 1-3, answers and competency ratings', async () => {
      const ok = { managerRating: 4, overallRating: 4 };
      expect(
        await errorsOf(SubmitManagerReviewDto, {
          ...ok, potentialRating: 3,
          answers: [{ cycleQuestionId: UUID, text: 'fine' }],
          competencyRatings: [{ id: UUID, rating: 5, comment: 'ok' }],
        }),
      ).toEqual([]);
      expect(await errorsOf(SubmitManagerReviewDto, { ...ok, potentialRating: 4 })).toEqual(['potentialRating']);
      expect(await errorsOf(SubmitManagerReviewDto, { ...ok, potentialRating: 0 })).toEqual(['potentialRating']);
      expect(
        await errorsOf(SubmitManagerReviewDto, { ...ok, competencyRatings: [{ id: UUID, rating: 6 }] }),
      ).toEqual(['competencyRatings']);
    });

    it('potential body is 1-3', async () => {
      expect(await errorsOf(SetPotentialDto, { potentialRating: 2 })).toEqual([]);
      expect(await errorsOf(SetPotentialDto, { potentialRating: 4 })).toEqual(['potentialRating']);
      expect(await errorsOf(SetPotentialDto, {})).toEqual(['potentialRating']);
    });
  });

  describe('template DTOs', () => {
    const entry = { questionId: UUID, audience: 'SELF' };

    it('question text is 1-500 chars and type is an enum', async () => {
      expect(await errorsOf(CreateQuestionDto, { text: 'x', type: 'RATING' })).toEqual([]);
      expect(await errorsOf(CreateQuestionDto, { text: '', type: 'RATING' })).toEqual(['text']);
      expect(await errorsOf(CreateQuestionDto, { text: 'x'.repeat(501), type: 'RATING' })).toEqual(['text']);
      expect(await errorsOf(CreateQuestionDto, { text: 'x', type: 'NOPE' })).toEqual(['type']);
      expect(await errorsOf(CreateQuestionDto, { text: 'x', type: 'TEXT', category: 'c'.repeat(101) })).toEqual(['category']);
    });

    it('template needs a 1-100 char name and 1-50 valid entries', async () => {
      expect(await errorsOf(CreateTemplateDto, { name: 'A', questions: [entry] })).toEqual([]);
      expect(await errorsOf(CreateTemplateDto, { name: '', questions: [entry] })).toEqual(['name']);
      expect(await errorsOf(CreateTemplateDto, { name: 'A', questions: [] })).toEqual(['questions']);
      expect(
        await errorsOf(CreateTemplateDto, { name: 'A', questions: Array.from({ length: 51 }, () => entry) }),
      ).toEqual(['questions']);
      expect(
        await errorsOf(CreateTemplateDto, { name: 'A', questions: [{ questionId: 'x', audience: 'NOPE' }] }),
      ).toEqual(['questions']);
    });
  });

  describe('peer DTOs', () => {
    it('add needs a peer employee uuid', async () => {
      expect(await errorsOf(AddPeerDto, { peerEmployeeId: UUID })).toEqual([]);
      expect(await errorsOf(AddPeerDto, { peerEmployeeId: 'x' })).toEqual(['peerEmployeeId']);
    });

    it('submit needs answers and a 1-5000 char comment', async () => {
      expect(
        await errorsOf(SubmitPeerFeedbackDto, { answers: [{ cycleQuestionId: UUID, rating: 3 }], overallComment: 'good' }),
      ).toEqual([]);
      expect(await errorsOf(SubmitPeerFeedbackDto, { answers: [], overallComment: '' })).toEqual(['overallComment']);
      expect(await errorsOf(SubmitPeerFeedbackDto, { overallComment: 'x' })).toEqual(['answers']);
    });
  });
});
