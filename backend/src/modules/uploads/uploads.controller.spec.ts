import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  upload: jest.fn(),
  getFilePath: jest.fn(),
  findByKey: jest.fn(),
  deleteByAdmin: jest.fn(),
};

describe('UploadsController', () => {
  let controller: UploadsController;
  let service: typeof mockService;

  const mockUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [{ provide: UploadsService, useValue: mockService }],
    }).compile();
    controller = module.get<UploadsController>(UploadsController);
    service = module.get(UploadsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // upload
  // ============================================
  describe('upload', () => {
    const mockFile = {
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('data'),
      size: 1024,
    } as Express.Multer.File;

    const dto = { entityType: 'employee_document', entityId: 'ent-1' };

    it('should upload a file and pass correct params to service', async () => {
      const expected = { id: 'upload-1', fileName: 'test.pdf' };
      service.upload.mockResolvedValue(expected);

      const result = await controller.upload(mockFile, dto, mockUser);

      expect(result).toEqual(expected);
      expect(service.upload).toHaveBeenCalledWith(
        mockFile,
        mockUser.tenantId,
        mockUser.userId,
        dto.entityType,
        dto.entityId,
      );
    });

    it('should throw BadRequestException when file is null', async () => {
      await expect(
        controller.upload(null as any, dto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when file is undefined', async () => {
      await expect(
        controller.upload(undefined as any, dto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // download
  // ============================================
  describe('download', () => {
    const mockRes = {
      setHeader: jest.fn(),
      sendFile: jest.fn(),
    } as any;

    it('should set headers and send file', async () => {
      const filePath = '/uploads/folder1/file.pdf';
      const upload = { mimeType: 'application/pdf', fileName: 'file.pdf' };
      service.getFilePath.mockResolvedValue(filePath);
      service.findByKey.mockResolvedValue(upload);

      await controller.download('folder1', 'file.pdf', mockRes, mockUser);

      expect(service.getFilePath).toHaveBeenCalledWith(
        'folder1/file.pdf',
        mockUser.tenantId,
      );
      expect(service.findByKey).toHaveBeenCalledWith(
        'folder1/file.pdf',
        mockUser.tenantId,
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="file.pdf"',
      );
      expect(mockRes.sendFile).toHaveBeenCalledWith(filePath);
    });

    it('should construct key from folder and filename', async () => {
      service.getFilePath.mockResolvedValue('/path');
      service.findByKey.mockResolvedValue({
        mimeType: 'image/png',
        fileName: 'photo.png',
      });

      await controller.download('images', 'photo.png', mockRes, mockUser);

      expect(service.getFilePath).toHaveBeenCalledWith(
        'images/photo.png',
        mockUser.tenantId,
      );
    });
  });

  // ============================================
  // delete
  // ============================================
  describe('delete', () => {
    it('should delete a file and return success message', async () => {
      service.deleteByAdmin.mockResolvedValue(undefined);

      const result = await controller.delete('folder1', 'file.pdf', mockUser);

      expect(result).toEqual({ message: 'File deleted successfully' });
      expect(service.deleteByAdmin).toHaveBeenCalledWith(
        'folder1/file.pdf',
        mockUser.tenantId,
      );
    });

    it('should construct the key correctly from folder and filename', async () => {
      service.deleteByAdmin.mockResolvedValue(undefined);

      await controller.delete('docs', 'report.xlsx', mockUser);

      expect(service.deleteByAdmin).toHaveBeenCalledWith(
        'docs/report.xlsx',
        mockUser.tenantId,
      );
    });
  });
});
