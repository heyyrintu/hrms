import { createMockPrismaService } from '../../../test/helpers';
import { RecognitionLeaderboardService } from './recognition-leaderboard.service';

describe('RecognitionLeaderboardService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let settings: { get: jest.Mock };
  let service: RecognitionLeaderboardService;

  const tenantId = 'tenant-1';

  beforeEach(() => {
    prisma = createMockPrismaService();
    settings = { get: jest.fn().mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 100 }) };
    service = new RecognitionLeaderboardService(prisma as any, settings as any);
  });

  it('returns an empty list with no groups', async () => {
    (prisma.recognitionRecipient.groupBy as jest.Mock).mockResolvedValue([]);

    const result = await service.leaderboard(tenantId, 'month');

    expect(result).toEqual([]);
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('ranks by points desc when points are enabled', async () => {
    settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 100 });
    (prisma.recognitionRecipient.groupBy as jest.Mock).mockResolvedValue([
      { employeeId: 'e-1', _sum: { points: 10 }, _count: { _all: 5 } },
      { employeeId: 'e-2', _sum: { points: 30 }, _count: { _all: 1 } },
    ]);
    (prisma.employee.findMany as jest.Mock).mockResolvedValue([
      { id: 'e-1', firstName: 'Alice', lastName: 'A', employeeCode: 'E1', department: { name: 'Eng' } },
      { id: 'e-2', firstName: 'Bob', lastName: 'B', employeeCode: 'E2', department: null },
    ]);

    const result = await service.leaderboard(tenantId, 'month');

    expect(result.map((r) => r.employeeId)).toEqual(['e-2', 'e-1']);
    expect(result[0]).toEqual(
      expect.objectContaining({ rank: 1, points: 30, department: null }),
    );
    expect(result[1]).toEqual(expect.objectContaining({ rank: 2, department: 'Eng' }));
  });

  it('ranks by count desc when points are disabled', async () => {
    settings.get.mockResolvedValue({ pointsEnabled: false, monthlyPointsAllowance: 100 });
    (prisma.recognitionRecipient.groupBy as jest.Mock).mockResolvedValue([
      { employeeId: 'e-1', _sum: { points: 100 }, _count: { _all: 2 } },
      { employeeId: 'e-2', _sum: { points: 10 }, _count: { _all: 9 } },
    ]);
    (prisma.employee.findMany as jest.Mock).mockResolvedValue([
      { id: 'e-1', firstName: 'Alice', lastName: 'A', employeeCode: 'E1', department: null },
      { id: 'e-2', firstName: 'Bob', lastName: 'B', employeeCode: 'E2', department: null },
    ]);

    const result = await service.leaderboard(tenantId, 'month');

    expect(result.map((r) => r.employeeId)).toEqual(['e-2', 'e-1']);
  });

  it('breaks ties by count then full name', async () => {
    settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 100 });
    (prisma.recognitionRecipient.groupBy as jest.Mock).mockResolvedValue([
      { employeeId: 'e-1', _sum: { points: 10 }, _count: { _all: 1 } },
      { employeeId: 'e-2', _sum: { points: 10 }, _count: { _all: 3 } },
      { employeeId: 'e-3', _sum: { points: 10 }, _count: { _all: 3 } },
    ]);
    (prisma.employee.findMany as jest.Mock).mockResolvedValue([
      { id: 'e-1', firstName: 'Zed', lastName: 'Z', employeeCode: 'E1', department: null },
      { id: 'e-2', firstName: 'Bob', lastName: 'B', employeeCode: 'E2', department: null },
      { id: 'e-3', firstName: 'Amy', lastName: 'A', employeeCode: 'E3', department: null },
    ]);

    const result = await service.leaderboard(tenantId, 'month');

    // e-2 and e-3 tie on points and count -> alphabetical by full name (Amy before Bob); e-1 last (lower count)
    expect(result.map((r) => r.employeeId)).toEqual(['e-3', 'e-2', 'e-1']);
  });

  it('passes no date filter for "all"', async () => {
    (prisma.recognitionRecipient.groupBy as jest.Mock).mockResolvedValue([]);

    await service.leaderboard(tenantId, 'all');

    const call = (prisma.recognitionRecipient.groupBy as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ tenantId });
  });

  it('caps at the top 20', async () => {
    settings.get.mockResolvedValue({ pointsEnabled: true, monthlyPointsAllowance: 100 });
    const groups = Array.from({ length: 25 }, (_, i) => ({
      employeeId: `e-${i}`,
      _sum: { points: 25 - i },
      _count: { _all: 1 },
    }));
    (prisma.recognitionRecipient.groupBy as jest.Mock).mockResolvedValue(groups);
    (prisma.employee.findMany as jest.Mock).mockResolvedValue(
      groups.map((g) => ({
        id: g.employeeId,
        firstName: g.employeeId,
        lastName: '',
        employeeCode: g.employeeId,
        department: null,
      })),
    );

    const result = await service.leaderboard(tenantId, 'month');

    expect(result).toHaveLength(20);
    expect(result[0].rank).toBe(1);
    expect(result[19].rank).toBe(20);
  });
});
