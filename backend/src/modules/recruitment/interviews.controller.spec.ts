import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { mockEmployee, mockHrAdmin } from '../../test/helpers';
import { InterviewsController } from './interviews.controller';
import { InterviewsService } from './interviews.service';

describe('InterviewsController', () => {
  let controller: InterviewsController;
  const service = {
    listForApplication: jest.fn().mockResolvedValue([]),
    schedule: jest.fn().mockResolvedValue({ id: 'int-1' }),
    update: jest.fn().mockResolvedValue({ id: 'int-1' }),
    setStatus: jest.fn().mockResolvedValue({ id: 'int-1' }),
    mine: jest.fn().mockResolvedValue([]),
    listFeedback: jest.fn().mockResolvedValue({ visible: true, items: [] }),
    submitFeedback: jest.fn().mockResolvedValue({ id: 'fb-1' }),
  };
  const reflector = new Reflector();
  const rolesOf = (name: keyof InterviewsController) =>
    reflector.get<UserRole[] | undefined>(ROLES_KEY, InterviewsController.prototype[name] as any);

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [InterviewsController],
      providers: [{ provide: InterviewsService, useValue: service }],
    }).compile();
    controller = moduleRef.get(InterviewsController);
  });

  it('restricts management routes to HR, SUPER and MANAGER', () => {
    for (const name of ['list', 'schedule', 'update', 'cancel', 'complete', 'noShow'] as const) {
      expect(rolesOf(name)).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER]);
    }
  });

  it('leaves mine and feedback open to every role (the service applies panel rules)', () => {
    expect(rolesOf('mine')).toBeUndefined();
    expect(rolesOf('feedback')).toBeUndefined();
    expect(rolesOf('submitFeedback')).toBeUndefined();
  });

  it('delegates with the actor', async () => {
    const dto = {
      roundName: 'R1',
      scheduledStart: '2026-03-15T09:00:00Z',
      scheduledEnd: '2026-03-15T10:00:00Z',
      panelEmployeeIds: ['e1'],
    };
    await controller.schedule(mockHrAdmin, 'app-1', dto);
    expect(service.schedule).toHaveBeenCalledWith(mockHrAdmin, 'app-1', dto);

    await controller.cancel(mockHrAdmin, 'int-1');
    await controller.complete(mockHrAdmin, 'int-1');
    await controller.noShow(mockHrAdmin, 'int-1');
    expect(service.setStatus.mock.calls.map((c) => c[2])).toEqual(['CANCELLED', 'COMPLETED', 'NO_SHOW']);

    await controller.mine(mockEmployee);
    expect(service.mine).toHaveBeenCalledWith(mockEmployee);

    const fb = { overallRating: 4, recommendation: 'HIRE' as const, scores: [] };
    await controller.submitFeedback(mockEmployee, 'int-1', fb);
    expect(service.submitFeedback).toHaveBeenCalledWith(mockEmployee, 'int-1', fb);
  });
});
