import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PeerReviewsController } from './peer-reviews.controller';
import { PeerReviewsService } from './peer-reviews.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { mockEmployee, mockManager } from '../../../test/helpers';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

const service = {
  listForReview: jest.fn(),
  add: jest.fn(),
  withdraw: jest.fn(),
  decide: jest.fn(),
  myRequests: jest.fn(),
  getRequest: jest.fn(),
  submit: jest.fn(),
  decline: jest.fn(),
};

const noEmployee: AuthenticatedUser = { ...mockEmployee, employeeId: undefined };

describe('PeerReviewsController', () => {
  let controller: PeerReviewsController;

  beforeEach(async () => {
    Object.values(service).forEach((fn) => fn.mockReset());
    const moduleRef = await Test.createTestingModule({
      controllers: [PeerReviewsController],
      providers: [{ provide: PeerReviewsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(PeerReviewsController);
  });

  it.each([
    'listForReview', 'add', 'withdraw', 'decide', 'myRequests', 'getRequest', 'submit', 'decline',
  ])('%s is open to every role (the service enforces the relation)', (method) => {
    const roles = Reflect.getMetadata(ROLES_KEY, (PeerReviewsController.prototype as any)[method]);
    expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE]);
  });

  describe('review-side routes pass the whole user', () => {
    it('listForReview', async () => {
      await controller.listForReview(mockEmployee, 'rev-1');
      expect(service.listForReview).toHaveBeenCalledWith(mockEmployee, 'rev-1');
    });

    it('add', async () => {
      const dto = { peerEmployeeId: 'p1' };
      await controller.add(mockManager, 'rev-1', dto);
      expect(service.add).toHaveBeenCalledWith(mockManager, 'rev-1', dto);
    });

    it('withdraw', async () => {
      await controller.withdraw(mockEmployee, 'rev-1', 'pr-1');
      expect(service.withdraw).toHaveBeenCalledWith(mockEmployee, 'rev-1', 'pr-1');
    });

    it('decide passes the boolean', async () => {
      await controller.decide(mockManager, 'rev-1', 'pr-1', { approve: false });
      expect(service.decide).toHaveBeenCalledWith(mockManager, 'rev-1', 'pr-1', false);
    });
  });

  describe('peer-requests routes', () => {
    it('delegate for a user with an employee profile', async () => {
      await controller.myRequests(mockEmployee);
      expect(service.myRequests).toHaveBeenCalledWith(mockEmployee);

      await controller.getRequest(mockEmployee, 'pr-1');
      expect(service.getRequest).toHaveBeenCalledWith(mockEmployee, 'pr-1');

      const dto = { answers: [], overallComment: 'ok' };
      await controller.submit(mockEmployee, 'pr-1', dto);
      expect(service.submit).toHaveBeenCalledWith(mockEmployee, 'pr-1', dto);

      await controller.decline(mockEmployee, 'pr-1');
      expect(service.decline).toHaveBeenCalledWith(mockEmployee, 'pr-1');
    });

    it('400 without an employee profile and never reach the service (Review Focus 5)', () => {
      expect(() => controller.myRequests(noEmployee)).toThrow(BadRequestException);
      expect(() => controller.getRequest(noEmployee, 'pr-1')).toThrow(BadRequestException);
      expect(() => controller.submit(noEmployee, 'pr-1', { answers: [], overallComment: 'x' })).toThrow(
        BadRequestException,
      );
      expect(() => controller.decline(noEmployee, 'pr-1')).toThrow(BadRequestException);
      for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
    });
  });
});
