import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CalibrationController } from './calibration.controller';
import { CalibrationService } from './calibration.service';
import { CalibrateDto } from './dto/calibration.dto';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';

const mockService = { calibrate: jest.fn(), getCalibration: jest.fn(), getNineBox: jest.fn() };

const admin: AuthenticatedUser = {
  userId: 'u1',
  email: 'a@test.com',
  tenantId: 't1',
  role: UserRole.HR_ADMIN,
  employeeId: 'emp-admin',
};

describe('CalibrationController', () => {
  let controller: CalibrationController;

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalibrationController],
      providers: [{ provide: CalibrationService, useValue: mockService }],
    }).compile();
    controller = module.get(CalibrationController);
  });

  it('calibrates through the service with the caller', async () => {
    mockService.calibrate.mockResolvedValue({ id: 'rev1' });
    const dto = { rating: 4, reason: 'Calibrated against peers' };
    expect(await controller.calibrate(admin, 'rev1', dto)).toEqual({ id: 'rev1' });
    expect(mockService.calibrate).toHaveBeenCalledWith(admin, 'rev1', dto);
  });

  it('passes the calibration and nine-box queries through', async () => {
    mockService.getCalibration.mockResolvedValue({});
    mockService.getNineBox.mockResolvedValue({});
    await controller.getCalibration(admin, { cycleId: 'c1' });
    await controller.getNineBox(admin, { cycleId: 'c1', departmentId: 'd1' });
    expect(mockService.getCalibration).toHaveBeenCalledWith(admin, { cycleId: 'c1' });
    expect(mockService.getNineBox).toHaveBeenCalledWith(admin, { cycleId: 'c1', departmentId: 'd1' });
  });

  it('restricts calibrate to admins and the read views to admins and managers', () => {
    const reflector = new Reflector();
    const roles = (fn: unknown) => [...reflector.get<UserRole[]>(ROLES_KEY, fn as never)].sort();
    expect(roles(CalibrationController.prototype.calibrate)).toEqual(
      [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN].sort(),
    );
    const readers = [UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN].sort();
    expect(roles(CalibrationController.prototype.getCalibration)).toEqual(readers);
    expect(roles(CalibrationController.prototype.getNineBox)).toEqual(readers);
  });

  describe('CalibrateDto', () => {
    const check = async (body: object) => validate(plainToInstance(CalibrateDto, body));

    it('accepts ratings 1-5 and null (revert) with a 10+ char reason', async () => {
      expect(await check({ rating: 1, reason: 'long enough reason' })).toHaveLength(0);
      expect(await check({ rating: 5, reason: 'long enough reason' })).toHaveLength(0);
      expect(await check({ rating: null, reason: 'long enough reason' })).toHaveLength(0);
    });

    it('rejects 0, 6, fractions, a missing rating and short or long reasons', async () => {
      expect(await check({ rating: 0, reason: 'long enough reason' })).not.toHaveLength(0);
      expect(await check({ rating: 6, reason: 'long enough reason' })).not.toHaveLength(0);
      expect(await check({ rating: 2.5, reason: 'long enough reason' })).not.toHaveLength(0);
      expect(await check({ reason: 'long enough reason' })).not.toHaveLength(0);
      expect(await check({ rating: 3, reason: 'too short' })).not.toHaveLength(0);
      expect(await check({ rating: 3, reason: 'x'.repeat(1001) })).not.toHaveLength(0);
    });
  });
});
