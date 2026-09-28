import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { mockEmployee, mockHrAdmin } from '../../../test/helpers';
import { RecognitionController } from './recognition.controller';

describe('RecognitionController', () => {
  const recognitionService = { give: jest.fn(), remove: jest.fn(), wall: jest.fn(), me: jest.fn() };
  const badgesService = { list: jest.fn(), create: jest.fn(), update: jest.fn(), deactivate: jest.fn() };
  const leaderboardService = { leaderboard: jest.fn() };
  let controller: RecognitionController;
  const reflector = new Reflector();

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RecognitionController(
      recognitionService as any,
      badgesService as any,
      leaderboardService as any,
    );
  });

  it('wall forwards the tenant and query', async () => {
    recognitionService.wall.mockResolvedValue({ data: [], meta: {} });

    await controller.wall(mockEmployee, { page: 1, limit: 20 });

    expect(recognitionService.wall).toHaveBeenCalledWith('test-tenant', { page: 1, limit: 20 });
  });

  it('give forwards the caller employeeId', async () => {
    recognitionService.give.mockResolvedValue({ id: 'rec-1' });

    await controller.give(mockEmployee, { recipientIds: ['r-1'], message: 'Nice' } as any);

    expect(recognitionService.give).toHaveBeenCalledWith('test-tenant', 'emp-employee', {
      recipientIds: ['r-1'],
      message: 'Nice',
    });
  });

  it('give rejects a caller with no employee record', async () => {
    const superAdminNoEmployee = { ...mockEmployee, employeeId: undefined };

    await expect(
      controller.give(superAdminNoEmployee as any, { recipientIds: ['r-1'], message: 'Nice' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(recognitionService.give).not.toHaveBeenCalled();
  });

  it('me rejects a caller with no employee record', async () => {
    const noEmployee = { ...mockEmployee, employeeId: undefined };

    await expect(controller.me(noEmployee as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(recognitionService.me).not.toHaveBeenCalled();
  });

  it('me forwards the caller employeeId', async () => {
    recognitionService.me.mockResolvedValue({ pointsEnabled: true });

    await controller.me(mockEmployee);

    expect(recognitionService.me).toHaveBeenCalledWith('test-tenant', 'emp-employee');
  });

  it('leaderboard defaults period to month', async () => {
    leaderboardService.leaderboard.mockResolvedValue([]);

    await controller.leaderboard(mockEmployee, {});

    expect(leaderboardService.leaderboard).toHaveBeenCalledWith('test-tenant', 'month');
  });

  describe('badges', () => {
    it('ignores includeInactive for a non-HR caller', async () => {
      badgesService.list.mockResolvedValue([]);

      await controller.badges(mockEmployee, { includeInactive: true });

      expect(badgesService.list).toHaveBeenCalledWith('test-tenant', false);
    });

    it('honours includeInactive for HR', async () => {
      badgesService.list.mockResolvedValue([]);

      await controller.badges(mockHrAdmin, { includeInactive: true });

      expect(badgesService.list).toHaveBeenCalledWith('test-tenant', true);
    });
  });

  describe('role metadata', () => {
    const rolesOn = (method: keyof RecognitionController) =>
      reflector.get<UserRole[]>(ROLES_KEY, RecognitionController.prototype[method] as any);

    it('lets every role read the wall, give, me, leaderboard and badges', () => {
      for (const method of ['wall', 'give', 'me', 'leaderboard', 'badges'] as const) {
        expect(rolesOn(method)).toEqual([
          UserRole.EMPLOYEE,
          UserRole.MANAGER,
          UserRole.HR_ADMIN,
          UserRole.SUPER_ADMIN,
        ]);
      }
    });

    it('limits badge writes and recognition delete to HR_ADMIN and SUPER_ADMIN', () => {
      for (const method of ['createBadge', 'updateBadge', 'deactivateBadge', 'remove'] as const) {
        expect(rolesOn(method)).toEqual([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]);
      }
    });
  });
});
