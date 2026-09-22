import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BiometricService } from './biometric.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OtCalculationService } from '../attendance/ot-calculation.service';
import { createMockPrismaService } from '../../test/helpers';

describe('BiometricService.handleAttendancePush', () => {
  let service: BiometricService;
  let prisma: any;

  const device = { id: 'dev-1', tenantId: 'tenant-1', serialNumber: 'SN1', isActive: true };
  const line = '42\t2026-09-09 09:00:00\t15\t0\t0\t0';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BiometricService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: OtCalculationService, useValue: {} },
      ],
    }).compile();

    service = module.get(BiometricService);
    prisma = module.get(PrismaService);
    prisma.biometricDevice.findUnique.mockResolvedValue(device);
    prisma.biometricDevice.update.mockResolvedValue(device);
  });

  it('acknowledges a punch the device re-sent without processing it a second time', async () => {
    prisma.deviceAttendanceLog.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.handleAttendancePush('SN1', line);

    expect(result).toBe('OK: 1');
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    expect(prisma.attendanceSession.create).not.toHaveBeenCalled();
  });

  // The device reports IST wall clock and AttendanceRecord.date is @db.Date,
  // which Prisma writes from the UTC date part. A late-evening punch must land
  // on the same UTC-midnight key the web clock-in path writes for that shift,
  // or the employee ends up with two attendance rows for one day — and the
  // auto-absent sweep reads that column on the same basis.
  it('puts a 23:30 IST punch on that IST day UTC-midnight key', async () => {
    prisma.deviceAttendanceLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.deviceAttendanceLog.update.mockResolvedValue({});
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    prisma.attendanceRecord.findUnique.mockResolvedValue(null);
    prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-1', sessions: [] });

    await service.handleAttendancePush('SN1', '42	2026-09-09 23:30:00	15	0	0	0');

    const expectedDay = new Date('2026-09-09T00:00:00.000Z');
    expect(prisma.attendanceRecord.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_employeeId_date: {
            tenantId: 'tenant-1',
            employeeId: 'emp-1',
            date: expectedDay,
          },
        },
      }),
    );
    expect(prisma.attendanceRecord.create.mock.calls[0][0].data.date).toEqual(expectedDay);
  });

  it('reads the device wall clock in the attendance zone, not the server zone', async () => {
    prisma.deviceAttendanceLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.deviceAttendanceLog.update.mockResolvedValue({});
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    prisma.attendanceRecord.findUnique.mockResolvedValue(null);
    prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-1', sessions: [] });

    await service.handleAttendancePush('SN1', '42	2026-09-09 23:30:00	15	0	0	0');

    // 23:30 IST is 18:00 UTC, whatever zone the server happens to run in.
    expect(prisma.attendanceRecord.create.mock.calls[0][0].data.clockInTime).toEqual(
      new Date('2026-09-09T18:00:00.000Z'),
    );
  });

  it('still processes a first-time punch normally', async () => {
    prisma.deviceAttendanceLog.create.mockResolvedValue({ id: 'log-1' });
    prisma.deviceAttendanceLog.update.mockResolvedValue({});
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
    prisma.attendanceRecord.findUnique.mockResolvedValue(null);
    prisma.attendanceRecord.create.mockResolvedValue({ id: 'att-1', sessions: [] });

    const result = await service.handleAttendancePush('SN1', line);

    expect(result).toBe('OK: 1');
    expect(prisma.attendanceRecord.create).toHaveBeenCalledTimes(1);
  });
});
