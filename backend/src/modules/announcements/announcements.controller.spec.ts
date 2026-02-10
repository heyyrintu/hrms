import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getActive: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('AnnouncementsController', () => {
  let controller: AnnouncementsController;
  let service: typeof mockService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  const employeeUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-2',
  };

  const adminNoEmployee: AuthenticatedUser = {
    userId: 'user-3',
    email: 'admin2@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnouncementsController],
      providers: [{ provide: AnnouncementsService, useValue: mockService }],
    }).compile();
    controller = module.get<AnnouncementsController>(AnnouncementsController);
    service = module.get(AnnouncementsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // getActive
  // ============================================
  describe('getActive', () => {
    it('should return active announcements', async () => {
      const expected = [{ id: 'ann-1', title: 'Holiday' }];
      service.getActive.mockResolvedValue(expected);

      const result = await controller.getActive(employeeUser);

      expect(result).toEqual(expected);
      expect(service.getActive).toHaveBeenCalledWith(employeeUser.tenantId);
    });
  });

  // ============================================
  // findAll
  // ============================================
  describe('findAll', () => {
    it('should return all announcements with query params', async () => {
      const expected = { data: [{ id: 'ann-1' }], total: 1 };
      const query = { page: 1, limit: 10, publishedOnly: true };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(adminUser, query);

      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledWith(adminUser.tenantId, query);
    });

    it('should pass empty query', async () => {
      service.findAll.mockResolvedValue({ data: [], total: 0 });

      await controller.findAll(adminUser, {});

      expect(service.findAll).toHaveBeenCalledWith(adminUser.tenantId, {});
    });
  });

  // ============================================
  // findById
  // ============================================
  describe('findById', () => {
    it('should return a single announcement', async () => {
      const expected = { id: 'ann-1', title: 'Test' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById(adminUser, 'ann-1');

      expect(result).toEqual(expected);
      expect(service.findById).toHaveBeenCalledWith(
        adminUser.tenantId,
        'ann-1',
      );
    });
  });

  // ============================================
  // create
  // ============================================
  describe('create', () => {
    const dto = { title: 'New Announcement', content: 'Some content' };

    it('should create an announcement', async () => {
      const expected = { id: 'ann-1', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(adminUser, dto);

      expect(result).toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(
        adminUser.tenantId,
        adminUser.employeeId,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.create(adminNoEmployee, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // update
  // ============================================
  describe('update', () => {
    const dto = { title: 'Updated Title' };

    it('should update an announcement', async () => {
      const expected = { id: 'ann-1', title: 'Updated Title' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update(adminUser, 'ann-1', dto);

      expect(result).toEqual(expected);
      expect(service.update).toHaveBeenCalledWith(
        adminUser.tenantId,
        'ann-1',
        dto,
      );
    });
  });

  // ============================================
  // delete
  // ============================================
  describe('delete', () => {
    it('should delete an announcement', async () => {
      const expected = { id: 'ann-1', deleted: true };
      service.delete.mockResolvedValue(expected);

      const result = await controller.delete(adminUser, 'ann-1');

      expect(result).toEqual(expected);
      expect(service.delete).toHaveBeenCalledWith(
        adminUser.tenantId,
        'ann-1',
      );
    });
  });
});
