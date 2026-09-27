import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FeedController } from './feed.controller';
import { FeedQueryService } from './feed-query.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

describe('FeedController', () => {
  let controller: FeedController;
  let feedQuery: { list: jest.Mock; toggleReaction: jest.Mock; hide: jest.Mock };

  const user: AuthenticatedUser = {
    userId: 'user-1',
    email: 'e@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  const userWithoutEmployee: AuthenticatedUser = {
    ...user,
    employeeId: undefined,
  };

  beforeEach(async () => {
    feedQuery = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      toggleReaction: jest.fn().mockResolvedValue({ reactionCounts: { LIKE: 0, CELEBRATE: 0 }, myReactions: [] }),
      hide: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedController],
      providers: [{ provide: FeedQueryService, useValue: feedQuery }],
    }).compile();

    controller = module.get(FeedController);
  });

  describe('list', () => {
    it('clamps limit and forwards cursor', async () => {
      await controller.list(user, 'cursor-1', 200);

      expect(feedQuery.list).toHaveBeenCalledWith('tenant-1', 'emp-1', { cursor: 'cursor-1', limit: 50 });
    });

    it('clamps a limit below 1 up to 1', async () => {
      await controller.list(user, undefined, 0);

      expect(feedQuery.list).toHaveBeenCalledWith('tenant-1', 'emp-1', { cursor: undefined, limit: 1 });
    });

    it('throws 400 when the user has no employee record', async () => {
      await expect(controller.list(userWithoutEmployee, undefined, 20)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('react', () => {
    it('toggles a reaction', async () => {
      await controller.react(user, 'item-1', { kind: 'LIKE' as any });

      expect(feedQuery.toggleReaction).toHaveBeenCalledWith('tenant-1', 'emp-1', 'item-1', 'LIKE');
    });

    it('throws 400 when the user has no employee record', async () => {
      await expect(
        controller.react(userWithoutEmployee, 'item-1', { kind: 'LIKE' as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('hide', () => {
    it('hides the item', async () => {
      const result = await controller.hide('item-1', user);

      expect(feedQuery.hide).toHaveBeenCalledWith('tenant-1', 'item-1');
      expect(result).toEqual({ success: true });
    });
  });
});
