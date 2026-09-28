jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomInt: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { randomInt } from 'crypto';
import { SurveyReleaseService, RELEASE_BATCH_MIN } from './survey-release.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('SurveyReleaseService', () => {
  let service: SurveyReleaseService;
  let prisma: any;
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };

  const tenantId = 'tenant-1';
  const surveyId = 'survey-1';

  const answerRows = (label: string) => [
    { questionId: 'q-1', textValue: label, choiceValues: [], numericValue: null },
  ];
  const pendingRow = (id: string, label: string) => ({
    id,
    payload: `cipher:${JSON.stringify(answerRows(label))}`,
  });

  function givePending(rows: { id: string; payload: string }[]) {
    prisma.$queryRaw.mockResolvedValue(rows.map((r) => ({ id: r.id })));
    prisma.surveyPendingResponse.findMany.mockResolvedValue(rows);
  }

  beforeEach(async () => {
    prisma = createMockPrismaService();
    encryption = {
      encrypt: jest.fn(),
      decrypt: jest.fn((v: string) => v.replace(/^cipher:/, '')),
    };
    // Identity shuffle by default: randomInt(0, i + 1) returns i.
    (randomInt as unknown as jest.Mock).mockImplementation((_min: number, max: number) => max - 1);
    let n = 0;
    prisma.surveyResponse.create.mockImplementation(async () => ({ id: `response-${++n}` }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurveyReleaseService,
        { provide: PrismaService, useValue: prisma },
        { provide: FieldEncryptionService, useValue: encryption },
      ],
    }).compile();
    service = module.get(SurveyReleaseService);
  });

  it('uses a batch minimum of 3', () => {
    expect(RELEASE_BATCH_MIN).toBe(3);
  });

  it('locks pending rows with FOR UPDATE SKIP LOCKED scoped by survey and tenant', async () => {
    givePending([]);
    await service.release(tenantId, surveyId, { force: false });

    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');
    expect(sql).toContain('FROM survey_pending_responses');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(values).toEqual([surveyId, tenantId]);
  });

  it('releases nothing when fewer than 3 are pending and force is false', async () => {
    givePending([pendingRow('p1', 'a'), pendingRow('p2', 'b')]);

    await expect(service.release(tenantId, surveyId, { force: false })).resolves.toBe(0);

    expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
    expect(prisma.surveyAnswer.createMany).not.toHaveBeenCalled();
    expect(prisma.surveyPendingResponse.deleteMany).not.toHaveBeenCalled();
  });

  it('releases a batch of 3 as anonymous responses and deletes the pending rows', async () => {
    givePending([pendingRow('p1', 'a'), pendingRow('p2', 'b'), pendingRow('p3', 'c')]);

    await expect(service.release(tenantId, surveyId, { force: false })).resolves.toBe(3);

    expect(prisma.surveyResponse.create).toHaveBeenCalledTimes(3);
    for (const [arg] of prisma.surveyResponse.create.mock.calls) {
      expect(arg.data).toEqual({ tenantId, surveyId, employeeId: null, submittedAt: null });
    }
    expect(prisma.surveyAnswer.createMany).toHaveBeenCalledTimes(3);
    expect(prisma.surveyAnswer.createMany.mock.calls[0][0]).toEqual({
      data: [
        {
          tenantId,
          responseId: 'response-1',
          questionId: 'q-1',
          textValue: 'a',
          choiceValues: [],
          numericValue: null,
        },
      ],
    });
    expect(prisma.surveyPendingResponse.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, surveyId, id: { in: ['p1', 'p2', 'p3'] } },
    });
  });

  it('never touches participant rows in the release transaction', async () => {
    givePending([pendingRow('p1', 'a'), pendingRow('p2', 'b'), pendingRow('p3', 'c')]);

    await service.release(tenantId, surveyId, { force: false });

    for (const fn of Object.values(prisma.surveyParticipant) as jest.Mock[]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('force releases a single pending response', async () => {
    givePending([pendingRow('p1', 'a')]);

    await expect(service.release(tenantId, surveyId, { force: true })).resolves.toBe(1);

    expect(prisma.surveyResponse.create).toHaveBeenCalledTimes(1);
    expect(prisma.surveyPendingResponse.deleteMany).toHaveBeenCalled();
  });

  it('returns 0 without writing when nothing is pending, even when forced', async () => {
    givePending([]);

    await expect(service.release(tenantId, surveyId, { force: true })).resolves.toBe(0);

    expect(prisma.surveyPendingResponse.findMany).not.toHaveBeenCalled();
    expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
  });

  it('inserts in an order shuffled with crypto.randomInt', async () => {
    // randomInt(0, i + 1) always 0: Fisher-Yates [a,b,c] -> swap(2,0) [c,b,a] -> swap(1,0) [b,c,a]
    (randomInt as unknown as jest.Mock).mockImplementation(() => 0);
    givePending([pendingRow('p1', 'a'), pendingRow('p2', 'b'), pendingRow('p3', 'c')]);

    await service.release(tenantId, surveyId, { force: false });

    expect(randomInt).toHaveBeenCalled();
    const order = prisma.surveyAnswer.createMany.mock.calls.map(
      ([arg]: [{ data: { textValue: string }[] }]) => arg.data[0].textValue,
    );
    expect(order).toEqual(['b', 'c', 'a']);
    expect(order).not.toEqual(['a', 'b', 'c']);
  });

  it('decrypts every payload through FieldEncryptionService', async () => {
    givePending([pendingRow('p1', 'a'), pendingRow('p2', 'b'), pendingRow('p3', 'c')]);

    await service.release(tenantId, surveyId, { force: false });

    expect(encryption.decrypt).toHaveBeenCalledTimes(3);
  });
});
