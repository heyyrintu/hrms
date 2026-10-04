import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TemplatesService } from './templates.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

const T = 'tenant-1';

describe('TemplatesService', () => {
  let service: TemplatesService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();
    service = module.get(TemplatesService);
    prisma = module.get(PrismaService);
  });

  // ============================================
  // Question bank
  // ============================================

  describe('listQuestions', () => {
    it('returns tenant questions with usedByTemplates counting distinct templates', async () => {
      prisma.reviewQuestion.findMany.mockResolvedValue([
        { id: 'q1', text: 'A', type: 'RATING', category: null, isActive: true },
        { id: 'q2', text: 'B', type: 'TEXT', category: 'Growth', isActive: false },
      ]);
      prisma.reviewTemplateQuestion.findMany.mockResolvedValue([
        { questionId: 'q1', templateId: 't1' },
        { questionId: 'q1', templateId: 't1' }, // same template, other audience
        { questionId: 'q1', templateId: 't2' },
      ]);

      const result = await service.listQuestions(T);

      expect(prisma.reviewQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: T } }),
      );
      expect(prisma.reviewTemplateQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: T } }),
      );
      expect(result).toEqual([
        expect.objectContaining({ id: 'q1', usedByTemplates: 2 }),
        expect.objectContaining({ id: 'q2', usedByTemplates: 0 }),
      ]);
    });
  });

  describe('createQuestion', () => {
    it('creates a question scoped to the tenant', async () => {
      prisma.reviewQuestion.create.mockResolvedValue({
        id: 'q1', text: 'Teamwork', type: 'RATING', category: 'Core', isActive: true,
      });

      const result = await service.createQuestion(T, {
        text: 'Teamwork', type: 'RATING' as any, category: 'Core',
      });

      expect(prisma.reviewQuestion.create).toHaveBeenCalledWith({
        data: { tenantId: T, text: 'Teamwork', type: 'RATING', category: 'Core', isActive: true },
      });
      expect(result).toEqual(expect.objectContaining({ id: 'q1', usedByTemplates: 0 }));
    });

    it('honours isActive=false', async () => {
      prisma.reviewQuestion.create.mockResolvedValue({ id: 'q1' });
      await service.createQuestion(T, { text: 'x', type: 'TEXT' as any, isActive: false });
      expect(prisma.reviewQuestion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isActive: false }),
      });
    });
  });

  describe('updateQuestion', () => {
    it('404s when the question is not in the tenant', async () => {
      prisma.reviewQuestion.findFirst.mockResolvedValue(null);
      await expect(service.updateQuestion(T, 'q1', { text: 'x' })).rejects.toThrow(NotFoundException);
      expect(prisma.reviewQuestion.findFirst).toHaveBeenCalledWith({ where: { id: 'q1', tenantId: T } });
      expect(prisma.reviewQuestion.update).not.toHaveBeenCalled();
    });

    it('updates only the provided fields', async () => {
      prisma.reviewQuestion.findFirst.mockResolvedValue({ id: 'q1' });
      prisma.reviewQuestion.update.mockResolvedValue({ id: 'q1', isActive: false });
      prisma.reviewTemplateQuestion.findMany.mockResolvedValue([]);

      await service.updateQuestion(T, 'q1', { isActive: false });

      expect(prisma.reviewQuestion.update).toHaveBeenCalledWith({
        where: { id: 'q1' },
        data: { isActive: false },
      });
    });
  });

  describe('deleteQuestion', () => {
    it('404s when missing', async () => {
      prisma.reviewQuestion.findFirst.mockResolvedValue(null);
      await expect(service.deleteQuestion(T, 'q1')).rejects.toThrow(NotFoundException);
    });

    it('refuses with 400 when any template entry references it', async () => {
      prisma.reviewQuestion.findFirst.mockResolvedValue({ id: 'q1' });
      prisma.reviewTemplateQuestion.count.mockResolvedValue(1);

      await expect(service.deleteQuestion(T, 'q1')).rejects.toThrow(BadRequestException);
      expect(prisma.reviewTemplateQuestion.count).toHaveBeenCalledWith({
        where: { tenantId: T, questionId: 'q1' },
      });
      expect(prisma.reviewQuestion.delete).not.toHaveBeenCalled();
    });

    it('deletes an unused question', async () => {
      prisma.reviewQuestion.findFirst.mockResolvedValue({ id: 'q1' });
      prisma.reviewTemplateQuestion.count.mockResolvedValue(0);

      await service.deleteQuestion(T, 'q1');

      expect(prisma.reviewQuestion.delete).toHaveBeenCalledWith({ where: { id: 'q1' } });
    });
  });

  // ============================================
  // Templates
  // ============================================

  const entries = [
    { questionId: 'q1', audience: 'SELF' as any },
    { questionId: 'q1', audience: 'MANAGER' as any, isRequired: false },
    { questionId: 'q2', audience: 'PEER' as any, sortOrder: 9 },
  ];

  function questionsInTenant(...qs: Array<{ id: string; isActive?: boolean }>) {
    prisma.reviewQuestion.findMany.mockResolvedValue(
      qs.map((q) => ({ id: q.id, isActive: q.isActive ?? true })),
    );
  }

  describe('createTemplate', () => {
    it('creates the template and its entries in one transaction with defaults', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      questionsInTenant({ id: 'q1' }, { id: 'q2' });
      prisma.reviewTemplate.create.mockResolvedValue({ id: 't1' });
      prisma.reviewTemplate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 't1', name: 'Annual', questions: [] });

      const result = await service.createTemplate(T, { name: 'Annual', questions: entries });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.reviewTemplate.create).toHaveBeenCalledWith({
        data: { tenantId: T, name: 'Annual', description: undefined, isActive: true },
      });
      expect(prisma.reviewTemplateQuestion.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId: T, templateId: 't1', questionId: 'q1', audience: 'SELF', isRequired: true, sortOrder: 0 },
          { tenantId: T, templateId: 't1', questionId: 'q1', audience: 'MANAGER', isRequired: false, sortOrder: 1 },
          { tenantId: T, templateId: 't1', questionId: 'q2', audience: 'PEER', isRequired: true, sortOrder: 9 },
        ],
      });
      expect(result).toEqual(expect.objectContaining({ id: 't1' }));
    });

    it('409s on a duplicate name', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue({ id: 'other' });
      await expect(service.createTemplate(T, { name: 'Annual', questions: entries })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.reviewTemplate.findFirst).toHaveBeenCalledWith({
        where: { tenantId: T, name: 'Annual' },
        select: { id: true },
      });
    });

    it('409s when the create loses a unique race (P2002)', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      questionsInTenant({ id: 'q1' }, { id: 'q2' });
      prisma.reviewTemplate.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(service.createTemplate(T, { name: 'Annual', questions: entries })).rejects.toThrow(
        ConflictException,
      );
    });

    it('404s when a question is not in the tenant', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      questionsInTenant({ id: 'q1' }); // q2 missing
      await expect(service.createTemplate(T, { name: 'A', questions: entries })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.reviewQuestion.findMany).toHaveBeenCalledWith({
        where: { tenantId: T, id: { in: ['q1', 'q2'] } },
        select: { id: true, isActive: true },
      });
      expect(prisma.reviewTemplate.create).not.toHaveBeenCalled();
    });

    it('400s when a question is inactive', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      questionsInTenant({ id: 'q1' }, { id: 'q2', isActive: false });
      await expect(service.createTemplate(T, { name: 'A', questions: entries })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('400s on a duplicate (questionId, audience) pair', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      questionsInTenant({ id: 'q1' });
      await expect(
        service.createTemplate(T, {
          name: 'A',
          questions: [
            { questionId: 'q1', audience: 'SELF' as any },
            { questionId: 'q1', audience: 'SELF' as any },
          ],
        }),
      ).rejects.toThrow(/duplicate/i);
    });

    it('400s with no entries', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      await expect(service.createTemplate(T, { name: 'A', questions: [] })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getTemplate / listTemplates', () => {
    it('lists tenant templates with ordered entries and question summary', async () => {
      prisma.reviewTemplate.findMany.mockResolvedValue([]);
      await service.listTemplates(T);
      expect(prisma.reviewTemplate.findMany).toHaveBeenCalledWith({
        where: { tenantId: T },
        orderBy: { createdAt: 'desc' },
        include: {
          questions: {
            orderBy: { sortOrder: 'asc' },
            include: { question: { select: { id: true, text: true, type: true, isActive: true } } },
          },
        },
      });
    });

    it('404s for a template outside the tenant', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      await expect(service.getTemplate(T, 't1')).rejects.toThrow(NotFoundException);
      expect(prisma.reviewTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1', tenantId: T } }),
      );
    });
  });

  describe('updateTemplate', () => {
    it('404s when missing', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      await expect(service.updateTemplate(T, 't1', { name: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('409s when renaming onto another template', async () => {
      prisma.reviewTemplate.findFirst
        .mockResolvedValueOnce({ id: 't1', name: 'Old' })
        .mockResolvedValueOnce({ id: 't2' });
      await expect(service.updateTemplate(T, 't1', { name: 'Taken' })).rejects.toThrow(ConflictException);
    });

    it('replaces the entry list inside a transaction', async () => {
      prisma.reviewTemplate.findFirst
        .mockResolvedValueOnce({ id: 't1', name: 'Annual' })
        .mockResolvedValueOnce({ id: 't1', name: 'Annual', questions: [] });
      questionsInTenant({ id: 'q1' }, { id: 'q2' });

      await service.updateTemplate(T, 't1', { description: 'new', questions: entries });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.reviewTemplate.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { description: 'new' },
      });
      expect(prisma.reviewTemplateQuestion.deleteMany).toHaveBeenCalledWith({
        where: { templateId: 't1', tenantId: T },
      });
      expect(prisma.reviewTemplateQuestion.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ templateId: 't1', questionId: 'q2', audience: 'PEER', sortOrder: 9 }),
        ]),
      });
    });

    it('does not touch entries when questions is omitted', async () => {
      prisma.reviewTemplate.findFirst
        .mockResolvedValueOnce({ id: 't1', name: 'Annual' })
        .mockResolvedValueOnce({ id: 't1' });

      await service.updateTemplate(T, 't1', { isActive: false });

      expect(prisma.reviewTemplateQuestion.deleteMany).not.toHaveBeenCalled();
      expect(prisma.reviewTemplateQuestion.createMany).not.toHaveBeenCalled();
    });

    it('rejects an inactive question in the replacement list', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValueOnce({ id: 't1', name: 'Annual' });
      questionsInTenant({ id: 'q1', isActive: false }, { id: 'q2' });
      await expect(service.updateTemplate(T, 't1', { questions: entries })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.reviewTemplateQuestion.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteTemplate', () => {
    it('404s when missing', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue(null);
      await expect(service.deleteTemplate(T, 't1')).rejects.toThrow(NotFoundException);
    });

    it('refuses with 400 while a DRAFT cycle uses it', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue({ id: 't1' });
      prisma.reviewCycle.count.mockResolvedValue(1);

      await expect(service.deleteTemplate(T, 't1')).rejects.toThrow(BadRequestException);
      expect(prisma.reviewCycle.count).toHaveBeenCalledWith({
        where: { tenantId: T, templateId: 't1', status: 'DRAFT' },
      });
      expect(prisma.reviewTemplate.delete).not.toHaveBeenCalled();
    });

    it('deletes when no DRAFT cycle uses it', async () => {
      prisma.reviewTemplate.findFirst.mockResolvedValue({ id: 't1' });
      prisma.reviewCycle.count.mockResolvedValue(0);

      await service.deleteTemplate(T, 't1');

      expect(prisma.reviewTemplate.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });
});
