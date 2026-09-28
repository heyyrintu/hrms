import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SurveyQuestionType, SurveyStatus } from '@prisma/client';
import { SurveySubmissionService } from './survey-submission.service';
import { SurveyReleaseService } from './survey-release.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('SurveySubmissionService', () => {
  let service: SurveySubmissionService;
  let prisma: any;
  let encryption: { encrypt: jest.Mock };
  let release: { release: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';
  const surveyId = 'survey-1';

  const question = {
    id: 'q-1',
    tenantId,
    surveyId,
    order: 0,
    type: SurveyQuestionType.TEXT,
    text: 'How do you feel?',
    required: true,
    options: [],
  };

  const activeSurvey = (overrides: Record<string, unknown> = {}) => ({
    id: surveyId,
    tenantId,
    status: SurveyStatus.ACTIVE,
    isAnonymous: false,
    closesAt: null,
    questions: [question],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = createMockPrismaService();
    encryption = { encrypt: jest.fn((plain: string) => `cipher:${plain}`) };
    release = { release: jest.fn().mockResolvedValue(0) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurveySubmissionService,
        { provide: PrismaService, useValue: prisma },
        { provide: FieldEncryptionService, useValue: encryption },
        { provide: SurveyReleaseService, useValue: release },
      ],
    }).compile();
    service = module.get<SurveySubmissionService>(SurveySubmissionService);
  });

  const dto = { answers: [{ questionId: 'q-1', text: 'Great' }] };

  it('404s when the survey does not exist for this tenant', async () => {
    prisma.survey.findFirst.mockResolvedValue(null);
    await expect(service.submit(tenantId, employeeId, surveyId, dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('400s when the survey is past its closesAt even though status is ACTIVE', async () => {
    prisma.survey.findFirst.mockResolvedValue(
      activeSurvey({ closesAt: new Date('2020-01-01T00:00:00Z') }),
    );
    await expect(service.submit(tenantId, employeeId, surveyId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400s when the survey is DRAFT or CLOSED', async () => {
    prisma.survey.findFirst.mockResolvedValue(activeSurvey({ status: SurveyStatus.CLOSED }));
    await expect(service.submit(tenantId, employeeId, surveyId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400s and does not updateMany on an invalid answer', async () => {
    prisma.survey.findFirst.mockResolvedValue(activeSurvey());
    await expect(
      service.submit(tenantId, employeeId, surveyId, { answers: [] }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.surveyParticipant.updateMany).not.toHaveBeenCalled();
  });

  it('409s when the participant has already responded', async () => {
    prisma.survey.findFirst.mockResolvedValue(activeSurvey());
    prisma.surveyParticipant.updateMany.mockResolvedValue({ count: 0 });
    prisma.surveyParticipant.findFirst.mockResolvedValue({ id: 'participant-1' });

    await expect(service.submit(tenantId, employeeId, surveyId, dto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('404s when the caller is not a participant', async () => {
    prisma.survey.findFirst.mockResolvedValue(activeSurvey());
    prisma.surveyParticipant.updateMany.mockResolvedValue({ count: 0 });
    prisma.surveyParticipant.findFirst.mockResolvedValue(null);

    await expect(service.submit(tenantId, employeeId, surveyId, dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('anonymous survey', () => {
    beforeEach(() => {
      prisma.survey.findFirst.mockResolvedValue(activeSurvey({ isAnonymous: true }));
      prisma.surveyParticipant.updateMany.mockResolvedValue({ count: 1 });
    });

    it('buffers one encrypted pending row and writes no response or answer rows', async () => {
      const result = await service.submit(tenantId, employeeId, surveyId, dto);

      const expectedPlain = JSON.stringify([
        { questionId: 'q-1', textValue: 'Great', choiceValues: [], numericValue: null },
      ]);
      expect(encryption.encrypt).toHaveBeenCalledWith(expectedPlain);
      expect(prisma.surveyPendingResponse.create).toHaveBeenCalledWith({
        data: { tenantId, surveyId, payload: `cipher:${expectedPlain}` },
        select: { id: true },
      });
      const pendingData = prisma.surveyPendingResponse.create.mock.calls[0][0].data;
      expect(pendingData).not.toHaveProperty('employeeId');
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
      expect(prisma.surveyAnswer.createMany).not.toHaveBeenCalled();
      expect(result).toEqual({ submitted: true });
    });

    it('flips the participant flag in the same transaction as the pending row', async () => {
      await service.submit(tenantId, employeeId, surveyId, dto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.surveyParticipant.updateMany).toHaveBeenCalledWith({
        where: { tenantId, surveyId, employeeId, submitted: false },
        data: { submitted: true },
      });
    });

    it('triggers a non-forced release after the submit commits', async () => {
      await service.submit(tenantId, employeeId, surveyId, dto);

      expect(release.release).toHaveBeenCalledWith(tenantId, surveyId, { force: false });
    });

    it('still succeeds when the release fails', async () => {
      release.release.mockRejectedValue(new Error('db blip'));

      await expect(service.submit(tenantId, employeeId, surveyId, dto)).resolves.toEqual({
        submitted: true,
      });
    });

    it('fails before any write when the encryption key is missing', async () => {
      encryption.encrypt.mockImplementation(() => {
        throw new InternalServerErrorException('FIELD_ENCRYPTION_KEY is not configured');
      });

      await expect(service.submit(tenantId, employeeId, surveyId, dto)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(prisma.surveyParticipant.updateMany).not.toHaveBeenCalled();
      expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
      expect(release.release).not.toHaveBeenCalled();
    });

    it('does not release when the participant already responded', async () => {
      prisma.surveyParticipant.updateMany.mockResolvedValue({ count: 0 });
      prisma.surveyParticipant.findFirst.mockResolvedValue({ id: 'participant-1' });

      await expect(service.submit(tenantId, employeeId, surveyId, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
      expect(release.release).not.toHaveBeenCalled();
    });
  });

  it('creates a named response with employeeId and submittedAt set', async () => {
    prisma.survey.findFirst.mockResolvedValue(activeSurvey({ isAnonymous: false }));
    prisma.surveyParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.surveyResponse.create.mockResolvedValue({ id: 'response-1' });

    await service.submit(tenantId, employeeId, surveyId, dto);

    const data = prisma.surveyResponse.create.mock.calls[0][0].data;
    expect(data.employeeId).toBe(employeeId);
    expect(data.submittedAt).toBeInstanceOf(Date);
    expect(prisma.surveyPendingResponse.create).not.toHaveBeenCalled();
    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(release.release).not.toHaveBeenCalled();
  });

  it('writes the normalized answers against the created response', async () => {
    prisma.survey.findFirst.mockResolvedValue(activeSurvey());
    prisma.surveyParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.surveyResponse.create.mockResolvedValue({ id: 'response-1' });

    await service.submit(tenantId, employeeId, surveyId, dto);

    expect(prisma.surveyAnswer.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId,
          responseId: 'response-1',
          questionId: 'q-1',
          textValue: 'Great',
          choiceValues: [],
          numericValue: null,
        },
      ],
    });
  });

  it('never returns a response id', async () => {
    prisma.survey.findFirst.mockResolvedValue(activeSurvey());
    prisma.surveyParticipant.updateMany.mockResolvedValue({ count: 1 });
    prisma.surveyResponse.create.mockResolvedValue({ id: 'response-1' });

    const result = await service.submit(tenantId, employeeId, surveyId, dto);

    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('responseId');
  });
});
