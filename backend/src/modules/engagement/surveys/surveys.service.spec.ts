import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  EngagementAudience,
  NotificationType,
  SurveyQuestionType,
  SurveyStatus,
} from '@prisma/client';
import { SurveysService } from './surveys.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SurveyReleaseService } from './survey-release.service';
import { createMockPrismaService, createMockNotificationsService } from '../../../test/helpers';
import { CreateSurveyDto } from './dto/survey.dto';

describe('SurveysService', () => {
  let service: SurveysService;
  let prisma: any;
  let notifications: any;
  let release: { release: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-hr';
  const surveyId = 'survey-1';

  const baseDto: CreateSurveyDto = {
    title: 'Q1 Pulse',
    audienceType: EngagementAudience.ALL,
    audienceIds: [],
    questions: [
      { type: SurveyQuestionType.TEXT, text: 'How do you feel?', required: true },
    ],
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    notifications = createMockNotificationsService();
    release = { release: jest.fn().mockResolvedValue(0) };
    prisma.survey.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurveysService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: SurveyReleaseService, useValue: release },
      ],
    }).compile();

    service = module.get<SurveysService>(SurveysService);
  });

  describe('create', () => {
    it('writes the survey and its questions in one transaction', async () => {
      prisma.survey.create.mockResolvedValue({ id: surveyId });
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.DRAFT,
        questions: [],
      });

      await service.create(tenantId, employeeId, baseDto);

      expect(prisma.survey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          title: 'Q1 Pulse',
          createdById: employeeId,
          audienceIds: [],
        }),
      });
      expect(prisma.surveyQuestion.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            tenantId,
            surveyId,
            order: 0,
            type: SurveyQuestionType.TEXT,
            options: [],
          }),
        ],
      });
    });

    it('validates DEPARTMENT audience ids belong to the tenant', async () => {
      prisma.department.count.mockResolvedValue(2);
      prisma.survey.create.mockResolvedValue({ id: surveyId });
      prisma.survey.findFirst.mockResolvedValue({ id: surveyId, questions: [] });

      await service.create(tenantId, employeeId, {
        ...baseDto,
        audienceType: EngagementAudience.DEPARTMENT,
        audienceIds: ['dept-1', 'dept-2'],
      });

      expect(prisma.department.count).toHaveBeenCalledWith({
        where: { tenantId, id: { in: ['dept-1', 'dept-2'] } },
      });
    });

    it('rejects a DEPARTMENT audience id from another tenant', async () => {
      prisma.department.count.mockResolvedValue(1);

      await expect(
        service.create(tenantId, employeeId, {
          ...baseDto,
          audienceType: EngagementAudience.DEPARTMENT,
          audienceIds: ['dept-1', 'dept-2'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.survey.create).not.toHaveBeenCalled();
    });

    it('rejects a choice question with fewer than 2 options', async () => {
      await expect(
        service.create(tenantId, employeeId, {
          ...baseDto,
          questions: [
            {
              type: SurveyQuestionType.SINGLE_CHOICE,
              text: 'Pick one',
              options: ['Only one'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update / delete', () => {
    it('rejects updating a non-DRAFT survey', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.ACTIVE,
        questions: [],
      });

      await expect(
        service.update(tenantId, surveyId, { title: 'New title' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('replaces questions on a draft survey', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.DRAFT,
        audienceType: EngagementAudience.ALL,
        audienceIds: [],
        questions: [],
      });

      await service.update(tenantId, surveyId, {
        questions: [{ type: SurveyQuestionType.TEXT, text: 'New question' }],
      });

      expect(prisma.surveyQuestion.deleteMany).toHaveBeenCalledWith({
        where: { surveyId },
      });
      expect(prisma.surveyQuestion.createMany).toHaveBeenCalled();
    });

    it('persists audienceIds sent alone against the existing DEPARTMENT/BRANCH type', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.DRAFT,
        audienceType: EngagementAudience.DEPARTMENT,
        audienceIds: ['dept-old'],
        questions: [],
      });
      prisma.department.count.mockResolvedValue(1);

      await service.update(tenantId, surveyId, { audienceIds: ['dept-new'] });

      expect(prisma.department.count).toHaveBeenCalledWith({
        where: { tenantId, id: { in: ['dept-new'] } },
      });
      expect(prisma.survey.updateMany).toHaveBeenCalledWith({
        where: { id: surveyId, tenantId, status: SurveyStatus.DRAFT },
        data: expect.objectContaining({
          audienceType: EngagementAudience.DEPARTMENT,
          audienceIds: ['dept-new'],
        }),
      });
    });

    it('clears audienceIds when audienceType ALL is sent alone', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.DRAFT,
        audienceType: EngagementAudience.DEPARTMENT,
        audienceIds: ['dept-old'],
        questions: [],
      });

      await service.update(tenantId, surveyId, { audienceType: EngagementAudience.ALL });

      expect(prisma.survey.updateMany).toHaveBeenCalledWith({
        where: { id: surveyId, tenantId, status: SurveyStatus.DRAFT },
        data: expect.objectContaining({
          audienceType: EngagementAudience.ALL,
          audienceIds: [],
        }),
      });
    });

    it('rejects audienceIds sent alone when the current audience is ALL', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.DRAFT,
        audienceType: EngagementAudience.ALL,
        audienceIds: [],
        questions: [],
      });

      await expect(
        service.update(tenantId, surveyId, { audienceIds: ['dept-1'] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.survey.updateMany).not.toHaveBeenCalled();
    });

    it('409s without touching questions when the survey stops being a draft mid-update', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.DRAFT,
        audienceType: EngagementAudience.ALL,
        audienceIds: [],
        questions: [],
      });
      // A concurrent launch won the race: the guarded write matches nothing.
      prisma.survey.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update(tenantId, surveyId, {
          isAnonymous: true,
          questions: [{ type: SurveyQuestionType.TEXT, text: 'Sneaky' }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.survey.updateMany).toHaveBeenCalledWith({
        where: { id: surveyId, tenantId, status: SurveyStatus.DRAFT },
        data: expect.objectContaining({ isAnonymous: true }),
      });
      expect(prisma.surveyQuestion.deleteMany).not.toHaveBeenCalled();
      expect(prisma.surveyQuestion.createMany).not.toHaveBeenCalled();
    });

    it('rejects deleting a non-DRAFT survey', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.CLOSED,
        questions: [],
      });

      await expect(service.delete(tenantId, surveyId)).rejects.toThrow(BadRequestException);
      expect(prisma.survey.delete).not.toHaveBeenCalled();
    });

    it('deletes a DRAFT survey', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        id: surveyId,
        tenantId,
        status: SurveyStatus.DRAFT,
        questions: [],
      });

      const result = await service.delete(tenantId, surveyId);

      expect(prisma.survey.delete).toHaveBeenCalledWith({ where: { id: surveyId } });
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('launch', () => {
    const draftSurvey = {
      id: surveyId,
      tenantId,
      title: 'Q1 Pulse',
      status: SurveyStatus.DRAFT,
      audienceType: EngagementAudience.DEPARTMENT,
      audienceIds: ['dept-1'],
      closesAt: null,
    };

    beforeEach(() => {
      prisma.survey.findFirst.mockResolvedValue(draftSurvey);
    });

    it('filters the audience by DEPARTMENT and ACTIVE status', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-a' }]);
      prisma.user.findMany.mockResolvedValue([]);
      // findById after launch
      prisma.survey.findFirst.mockResolvedValueOnce(draftSurvey).mockResolvedValueOnce({
        ...draftSurvey,
        status: SurveyStatus.ACTIVE,
        questions: [],
      });

      await service.launch(tenantId, surveyId);

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId, status: 'ACTIVE', departmentId: { in: ['dept-1'] } },
        select: { id: true },
      });
    });

    it('excludes inactive employees from the audience snapshot', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-a' }]);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.survey.findFirst.mockResolvedValueOnce(draftSurvey).mockResolvedValueOnce({
        ...draftSurvey,
        status: SurveyStatus.ACTIVE,
        questions: [],
      });

      await service.launch(tenantId, surveyId);

      const where = prisma.employee.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('ACTIVE');
    });

    it('returns 409 and does not createMany on a second launch', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.launch(tenantId, surveyId)).rejects.toThrow(ConflictException);
      expect(prisma.surveyParticipant.createMany).not.toHaveBeenCalled();
    });

    it('rejects an empty audience with 400', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.employee.findMany.mockResolvedValue([]);

      await expect(service.launch(tenantId, surveyId)).rejects.toThrow(BadRequestException);
      expect(prisma.surveyParticipant.createMany).not.toHaveBeenCalled();
    });

    it('notifies each active participant user after commit', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-a' }, { id: 'emp-b' }]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-a' }]);
      prisma.survey.findFirst.mockResolvedValueOnce(draftSurvey).mockResolvedValueOnce({
        ...draftSurvey,
        status: SurveyStatus.ACTIVE,
        questions: [],
      });

      await service.launch(tenantId, surveyId);

      expect(notifications.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          tenantId,
          userId: 'user-a',
          type: NotificationType.SURVEY_LAUNCHED,
          title: 'New survey',
          message: 'Q1 Pulse',
          link: `/engagement/surveys/${surveyId}`,
        }),
      ]);
    });

    it('does not throw when notification lookup fails', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-a' }]);
      prisma.user.findMany.mockRejectedValue(new Error('db down'));
      prisma.survey.findFirst.mockResolvedValueOnce(draftSurvey).mockResolvedValueOnce({
        ...draftSurvey,
        status: SurveyStatus.ACTIVE,
        questions: [],
      });

      await expect(service.launch(tenantId, surveyId)).resolves.toBeDefined();
    });

    it('404s a survey from another tenant', async () => {
      prisma.survey.findFirst.mockResolvedValue(null);
      await expect(service.launch(tenantId, surveyId)).rejects.toThrow(NotFoundException);
    });

    it('builds the audience from a fresh read inside the transaction, not the pre-read snapshot', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-a' }]);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.survey.findFirst
        .mockResolvedValueOnce(draftSurvey) // pre-transaction read
        .mockResolvedValueOnce({
          audienceType: EngagementAudience.BRANCH,
          audienceIds: ['branch-9'],
        }) // fresh read after the guarded flip
        .mockResolvedValueOnce({ ...draftSurvey, status: SurveyStatus.ACTIVE, questions: [] });

      await service.launch(tenantId, surveyId);

      expect(prisma.survey.findFirst.mock.calls[1][0]).toEqual({
        where: { id: surveyId, tenantId },
        select: { audienceType: true, audienceIds: true },
      });
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId, status: 'ACTIVE', branchId: { in: ['branch-9'] } },
        select: { id: true },
      });
    });
  });

  describe('close', () => {
    it('closes an ACTIVE survey', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.survey.findFirst.mockResolvedValue({ id: surveyId, questions: [] });

      await service.close(tenantId, surveyId);

      expect(prisma.survey.updateMany).toHaveBeenCalledWith({
        where: { id: surveyId, tenantId, status: SurveyStatus.ACTIVE },
        data: expect.objectContaining({ status: SurveyStatus.CLOSED }),
      });
    });

    it('rejects closing when the survey is not ACTIVE', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.close(tenantId, surveyId)).rejects.toThrow(BadRequestException);
      expect(release.release).not.toHaveBeenCalled();
    });

    it('force-releases pending anonymous responses after the close commits', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.survey.findFirst.mockResolvedValue({ id: surveyId, questions: [] });

      await service.close(tenantId, surveyId);

      expect(release.release).toHaveBeenCalledWith(tenantId, surveyId, { force: true });
      expect(prisma.survey.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        release.release.mock.invocationCallOrder[0],
      );
    });

    it('still closes when the release fails (the cron retries it)', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 1 });
      prisma.survey.findFirst.mockResolvedValue({ id: surveyId, questions: [] });
      release.release.mockRejectedValue(new Error('db blip'));

      await expect(service.close(tenantId, surveyId)).resolves.toEqual({
        id: surveyId,
        questions: [],
      });
    });
  });

  describe('mine', () => {
    it('marks an ACTIVE survey past closesAt as not open', async () => {
      prisma.surveyParticipant.findMany.mockResolvedValue([
        {
          submitted: false,
          survey: {
            id: surveyId,
            title: 'Q1 Pulse',
            description: null,
            isAnonymous: false,
            status: SurveyStatus.ACTIVE,
            closesAt: new Date('2020-01-01T00:00:00Z'),
            launchedAt: new Date('2019-01-01T00:00:00Z'),
            _count: { questions: 3 },
          },
        },
      ]);

      const result = await service.mine(tenantId, employeeId);

      expect(result[0].isOpen).toBe(false);
    });
  });

  describe('form', () => {
    it('404s when the caller has no participant row', async () => {
      prisma.surveyParticipant.findFirst.mockResolvedValue(null);
      await expect(service.form(tenantId, employeeId, surveyId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the survey and submitted flag for a participant', async () => {
      prisma.surveyParticipant.findFirst.mockResolvedValue({ submitted: true });
      prisma.survey.findFirst.mockResolvedValue({ id: surveyId, questions: [] });

      const result = await service.form(tenantId, employeeId, surveyId);

      expect(result.submitted).toBe(true);
    });
  });
});
