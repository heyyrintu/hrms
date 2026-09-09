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
