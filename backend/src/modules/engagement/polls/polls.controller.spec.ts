import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PollsController } from './polls.controller';
import { PollsService } from './polls.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

describe('PollsController', () => {
  let controller: PollsController;
  let pollsService: {
    active: jest.Mock;
    recentClosed: jest.Mock;
    list: jest.Mock;
    create: jest.Mock;
    vote: jest.Mock;
    close: jest.Mock;
    remove: jest.Mock;
  };

  const employee: AuthenticatedUser = {
    userId: 'user-1',
    email: 'e@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  const hrUser: AuthenticatedUser = { ...employee, role: UserRole.HR_ADMIN, employeeId: 'emp-hr' };

  const userWithoutEmployee: AuthenticatedUser = { ...employee, employeeId: undefined };

  beforeEach(async () => {
    pollsService = {
      active: jest.fn().mockResolvedValue([]),
      recentClosed: jest.fn().mockResolvedValue([]),
      list: jest.fn().mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }),
      create: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      vote: jest.fn().mockResolvedValue({ success: true }),
      close: jest.fn().mockResolvedValue({ success: true }),
      remove: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PollsController],
      providers: [{ provide: PollsService, useValue: pollsService }],
    }).compile();

    controller = module.get(PollsController);
  });

  it('active passes isAdmin=false for a plain employee', async () => {
    await controller.active(employee);
    expect(pollsService.active).toHaveBeenCalledWith('tenant-1', 'emp-1', false);
  });

  it('active passes isAdmin=true for HR', async () => {
    await controller.active(hrUser);
    expect(pollsService.active).toHaveBeenCalledWith('tenant-1', 'emp-hr', true);
  });

  it('recentClosed passes only the tenant, for any role', async () => {
    await controller.recentClosed(employee);
    expect(pollsService.recentClosed).toHaveBeenCalledWith('tenant-1');
  });

  it('recentClosed is declared before :id routes and has no role restriction', () => {
    const names = Object.getOwnPropertyNames(PollsController.prototype);
    expect(names.indexOf('recentClosed')).toBeLessThan(names.indexOf('vote'));
    expect(Reflect.getMetadata('roles', PollsController.prototype.recentClosed)).toBeUndefined();
  });

  it('list forwards pagination', async () => {
    await controller.list(hrUser, { page: 2, limit: 10 });
    expect(pollsService.list).toHaveBeenCalledWith('tenant-1', 2, 10);
  });

  it('create throws 400 when the caller has no employee record', async () => {
    await expect(
      controller.create(userWithoutEmployee, { question: 'Q?', options: ['A', 'B'] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create forwards to the service', async () => {
    await controller.create(hrUser, { question: 'Q?', options: ['A', 'B'] });
    expect(pollsService.create).toHaveBeenCalledWith('tenant-1', 'emp-hr', {
      question: 'Q?',
      options: ['A', 'B'],
    });
  });

  it('vote throws 400 when the caller has no employee record', async () => {
    await expect(
      controller.vote(userWithoutEmployee, 'poll-1', { optionId: 'opt-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('vote forwards to the service', async () => {
    await controller.vote(employee, 'poll-1', { optionId: 'opt-1' });
    expect(pollsService.vote).toHaveBeenCalledWith('tenant-1', 'poll-1', 'emp-1', { optionId: 'opt-1' });
  });

  it('close forwards to the service', async () => {
    await controller.close(hrUser, 'poll-1');
    expect(pollsService.close).toHaveBeenCalledWith('tenant-1', 'poll-1');
  });

  it('remove forwards to the service', async () => {
    await controller.remove(hrUser, 'poll-1');
    expect(pollsService.remove).toHaveBeenCalledWith('tenant-1', 'poll-1');
  });
});
