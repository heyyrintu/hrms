import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createMockPrismaService, mockHrAdmin, mockManager } from '../../test/helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { RecruitmentReportsService } from './recruitment-reports.service';

describe('RecruitmentReportsService', () => {
  const tenantId = 'test-tenant';
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: RecruitmentReportsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new RecruitmentReportsService(prisma as unknown as PrismaService);
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.pipelineStage.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.jobApplicationStageEvent.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.jobApplication.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.jobOffer.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('400s a manager who omits jobOpeningId', async () => {
    await expect(service.funnel(mockManager, {})).rejects.toThrow(BadRequestException);
  });

  it('404s a manager whose jobOpeningId does not exist in the tenant', async () => {
    (prisma.jobOpening.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.funnel(mockManager, { jobOpeningId: 'opening-1' })).rejects.toThrow(NotFoundException);
  });

  it('403s a manager who is not the hiring manager for the opening', async () => {
    (prisma.jobOpening.findFirst as jest.Mock).mockResolvedValue({ id: 'opening-1', hiringManagerId: 'someone-else' });
    await expect(service.funnel(mockManager, { jobOpeningId: 'opening-1' })).rejects.toThrow(ForbiddenException);
  });

  it('allows a manager scoped to their own opening', async () => {
    (prisma.jobOpening.findFirst as jest.Mock).mockResolvedValue({ id: 'opening-1', hiringManagerId: mockManager.employeeId });
    const result = await service.funnel(mockManager, { jobOpeningId: 'opening-1' });
    expect(result.jobOpeningId).toBe('opening-1');
  });

  it('computes totals, bySource and null offerAcceptanceRate with no data', async () => {
    const result = await service.funnel(mockHrAdmin, {});
    expect(result.totals).toEqual({
      applied: 0,
      hired: 0,
      rejected: 0,
      withdrawn: 0,
      offersSent: 0,
      offersAccepted: 0,
      offersDeclined: 0,
      offerAcceptanceRate: null,
      avgTimeToHireDays: null,
    });
    expect(result.bySource).toEqual([]);
  });

  it('aggregates totals, bySource, and avgTimeToHireDays from applications and offers', async () => {
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([
      { id: 'app-1', status: 'HIRED', source: 'CAREERS_PAGE', appliedAt: new Date('2026-01-01T12:00:00Z'), hiredAt: new Date('2026-01-11T12:00:00Z') },
      { id: 'app-2', status: 'REJECTED', source: 'REFERRAL', appliedAt: new Date('2026-01-02T12:00:00Z'), hiredAt: null },
      { id: 'app-3', status: 'WITHDRAWN', source: 'CAREERS_PAGE', appliedAt: new Date('2026-01-03T12:00:00Z'), hiredAt: null },
      { id: 'app-4', status: 'ACTIVE', source: 'CAREERS_PAGE', appliedAt: new Date('2026-01-04T12:00:00Z'), hiredAt: null },
    ]);
    (prisma.jobOffer.findMany as jest.Mock).mockResolvedValue([
      { status: 'ACCEPTED' },
      { status: 'DECLINED' },
      { status: 'SENT' },
    ]);

    const result = await service.funnel(mockHrAdmin, {});

    expect(result.totals.applied).toBe(4);
    expect(result.totals.hired).toBe(1);
    expect(result.totals.rejected).toBe(1);
    expect(result.totals.withdrawn).toBe(1);
    expect(result.totals.avgTimeToHireDays).toBe(10);
    expect(result.totals.offersSent).toBe(3);
    expect(result.totals.offersAccepted).toBe(1);
    expect(result.totals.offersDeclined).toBe(1);
    expect(result.totals.offerAcceptanceRate).toBe(50);
    expect(result.bySource).toEqual(
      expect.arrayContaining([
        { source: 'CAREERS_PAGE', count: 3 },
        { source: 'REFERRAL', count: 1 },
      ]),
    );
  });

  it('computes reached/current/conversion per stage from stage events', async () => {
    const stages = [
      { id: 'stage-applied', name: 'Applied', sortOrder: 1, category: 'APPLIED' },
      { id: 'stage-screen', name: 'Screening', sortOrder: 2, category: 'SCREENING' },
      { id: 'stage-interview', name: 'Interview', sortOrder: 3, category: 'INTERVIEW' },
    ];
    (prisma.pipelineStage.findMany as jest.Mock).mockResolvedValue(stages);
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([
      { id: 'app-1', status: 'ACTIVE', source: 'DIRECT', appliedAt: new Date('2026-01-01T12:00:00Z'), hiredAt: null },
      { id: 'app-2', status: 'ACTIVE', source: 'DIRECT', appliedAt: new Date('2026-01-01T12:00:00Z'), hiredAt: null },
    ]);
    // app-1 went Applied -> Screening -> Interview; app-2 stayed at Applied.
    (prisma.jobApplicationStageEvent.findMany as jest.Mock).mockResolvedValue([
      {
        applicationId: 'app-1',
        toStageId: 'stage-applied',
        toStage: { sortOrder: 1, category: 'APPLIED' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        applicationId: 'app-1',
        toStageId: 'stage-screen',
        toStage: { sortOrder: 2, category: 'SCREENING' },
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        applicationId: 'app-1',
        toStageId: 'stage-interview',
        toStage: { sortOrder: 3, category: 'INTERVIEW' },
        createdAt: new Date('2026-01-04T00:00:00Z'),
      },
      {
        applicationId: 'app-2',
        toStageId: 'stage-applied',
        toStage: { sortOrder: 1, category: 'APPLIED' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    (prisma.jobApplication.groupBy as jest.Mock).mockResolvedValue([
      { stageId: 'stage-applied', _count: { _all: 1 } },
      { stageId: 'stage-interview', _count: { _all: 1 } },
    ]);

    const result = await service.funnel(mockHrAdmin, {});

    const applied = result.stages.find((s) => s.stageId === 'stage-applied')!;
    const screening = result.stages.find((s) => s.stageId === 'stage-screen')!;
    const interview = result.stages.find((s) => s.stageId === 'stage-interview')!;

    expect(applied.reached).toBe(2);
    expect(applied.current).toBe(1);
    expect(applied.conversionFromPrevious).toBeNull();
    // 1 day spent at Applied for app-1 (2026-01-01 -> 2026-01-02).
    expect(applied.avgDaysInStage).toBe(1);

    expect(screening.reached).toBe(1);
    expect(screening.conversionFromPrevious).toBe(50);
    // 2 days spent at Screening for app-1 (2026-01-02 -> 2026-01-04).
    expect(screening.avgDaysInStage).toBe(2);

    expect(interview.reached).toBe(1);
    expect(interview.current).toBe(1);
    expect(interview.conversionFromPrevious).toBe(100);
    // Still open (no further event) — excluded from the average.
    expect(interview.avgDaysInStage).toBeNull();
  });
});
