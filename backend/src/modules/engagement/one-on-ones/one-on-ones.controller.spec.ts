import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OneOnOnesController } from './one-on-ones.controller';
import { OneOnOnesService } from './one-on-ones.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

const mockService = {
  list: jest.fn(),
  create: jest.fn(),
  openItems: jest.fn(),
  counterparts: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  addItem: jest.fn(),
  updateItem: jest.fn(),
  removeItem: jest.fn(),
  upsertPrivateNote: jest.fn(),
};

describe('OneOnOnesController', () => {
  let controller: OneOnOnesController;

  const employeeUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  const userWithoutEmployee: AuthenticatedUser = {
    userId: 'user-2',
    email: 'orphan@test.com',
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OneOnOnesController],
      providers: [{ provide: OneOnOnesService, useValue: mockService }],
    }).compile();

    controller = module.get(OneOnOnesController);
  });

  it('lists my one-on-ones', async () => {
    mockService.list.mockResolvedValue([{ id: 'm-1' }]);
    const result = await controller.list(employeeUser, {});
    expect(mockService.list).toHaveBeenCalledWith('tenant-1', 'emp-1', {});
    expect(result).toEqual([{ id: 'm-1' }]);
  });

  it('schedules a one-on-one', async () => {
    const dto = { counterpartId: 'emp-2', scheduledAt: '2026-03-15T12:00:00Z' };
    mockService.create.mockResolvedValue({ id: 'm-1' });
    await controller.create(employeeUser, dto as any);
    expect(mockService.create).toHaveBeenCalledWith('tenant-1', 'emp-1', dto);
  });

  it('gets open items for a counterpart', async () => {
    mockService.openItems.mockResolvedValue([]);
    await controller.openItems(employeeUser, { counterpartId: 'emp-2' });
    expect(mockService.openItems).toHaveBeenCalledWith('tenant-1', 'emp-1', 'emp-2');
  });

  it('gets counterparts', async () => {
    mockService.counterparts.mockResolvedValue([]);
    await controller.counterparts(employeeUser);
    expect(mockService.counterparts).toHaveBeenCalledWith('tenant-1', 'emp-1');
  });

  it('gets a one-on-one by id', async () => {
    mockService.get.mockResolvedValue({ id: 'm-1' });
    await controller.get(employeeUser, 'm-1');
    expect(mockService.get).toHaveBeenCalledWith('tenant-1', 'emp-1', 'm-1');
  });

  it('updates a one-on-one', async () => {
    const dto = { sharedNotes: 'notes' };
    mockService.update.mockResolvedValue({ id: 'm-1' });
    await controller.update(employeeUser, 'm-1', dto as any);
    expect(mockService.update).toHaveBeenCalledWith('tenant-1', 'emp-1', 'm-1', dto);
  });

  it('adds an action item', async () => {
    const dto = { text: 'do the thing', assigneeId: 'emp-1' };
    mockService.addItem.mockResolvedValue({ id: 'item-1' });
    await controller.addItem(employeeUser, 'm-1', dto as any);
    expect(mockService.addItem).toHaveBeenCalledWith('tenant-1', 'emp-1', 'm-1', dto);
  });

  it('updates an action item', async () => {
    const dto = { isDone: true };
    mockService.updateItem.mockResolvedValue({ id: 'item-1' });
    await controller.updateItem(employeeUser, 'm-1', 'item-1', dto as any);
    expect(mockService.updateItem).toHaveBeenCalledWith('tenant-1', 'emp-1', 'm-1', 'item-1', dto);
  });

  it('removes an action item', async () => {
    mockService.removeItem.mockResolvedValue({ id: 'item-1' });
    await controller.removeItem(employeeUser, 'm-1', 'item-1');
    expect(mockService.removeItem).toHaveBeenCalledWith('tenant-1', 'emp-1', 'm-1', 'item-1');
  });

  it('saves a private note', async () => {
    const dto = { content: 'secret' };
    mockService.upsertPrivateNote.mockResolvedValue({ content: 'secret' });
    await controller.savePrivateNote(employeeUser, 'm-1', dto as any);
    expect(mockService.upsertPrivateNote).toHaveBeenCalledWith('tenant-1', 'emp-1', 'm-1', dto);
  });

  describe('employeeId guard', () => {
    it('400s list for a user without an employee record', async () => {
      await expect(controller.list(userWithoutEmployee, {})).rejects.toThrow(BadRequestException);
      expect(mockService.list).not.toHaveBeenCalled();
    });

    it('400s create for a user without an employee record', async () => {
      await expect(
        controller.create(userWithoutEmployee, { counterpartId: 'x', scheduledAt: '2026-03-15T12:00:00Z' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('400s openItems for a user without an employee record', async () => {
      await expect(controller.openItems(userWithoutEmployee, { counterpartId: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('400s counterparts for a user without an employee record', async () => {
      await expect(controller.counterparts(userWithoutEmployee)).rejects.toThrow(BadRequestException);
    });

    it('400s get for a user without an employee record', async () => {
      await expect(controller.get(userWithoutEmployee, 'm-1')).rejects.toThrow(BadRequestException);
    });

    it('400s update for a user without an employee record', async () => {
      await expect(controller.update(userWithoutEmployee, 'm-1', {} as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('400s addItem for a user without an employee record', async () => {
      await expect(
        controller.addItem(userWithoutEmployee, 'm-1', { text: 'x', assigneeId: 'y' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('400s updateItem for a user without an employee record', async () => {
      await expect(
        controller.updateItem(userWithoutEmployee, 'm-1', 'item-1', {} as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('400s removeItem for a user without an employee record', async () => {
      await expect(controller.removeItem(userWithoutEmployee, 'm-1', 'item-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('400s savePrivateNote for a user without an employee record', async () => {
      await expect(
        controller.savePrivateNote(userWithoutEmployee, 'm-1', { content: 'x' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
