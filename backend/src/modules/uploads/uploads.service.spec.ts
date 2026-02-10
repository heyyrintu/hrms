import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { createMockPrismaService } from '../../test/helpers';

function createMockStorageService() {
  return {
    upload: jest.fn(),
    getFilePath: jest.fn(),
    delete: jest.fn(),
  };
}

describe('UploadsService', () => {
  let service: UploadsService;
  let prisma: any;
  let storageService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: StorageService, useValue: createMockStorageService() },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
    prisma = module.get(PrismaService);
    storageService = module.get(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================
  // upload()
  // ============================
  describe('upload', () => {
    const mockFile = {
      originalname: 'resume.pdf',
      mimetype: 'application/pdf',
      size: 12345,
      buffer: Buffer.from('file-content'),
    } as Express.Multer.File;

    const tenantId = 'tenant-1';
    const userId = 'user-1';

    it('should upload a file and create a record', async () => {
      const uploadedResult = {
        key: 'general/uuid.pdf',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        size: 12345,
      };
      storageService.upload.mockResolvedValue(uploadedResult);

      const createdRecord = {
        id: 'upload-1',
        tenantId,
        key: uploadedResult.key,
        fileName: uploadedResult.fileName,
        mimeType: uploadedResult.mimeType,
        size: uploadedResult.size,
        uploadedBy: userId,
        entityType: undefined,
        entityId: undefined,
      };
      prisma.upload.create.mockResolvedValue(createdRecord);

      const result = await service.upload(mockFile, tenantId, userId);

      expect(storageService.upload).toHaveBeenCalledWith(mockFile, undefined, undefined);
      expect(prisma.upload.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          key: uploadedResult.key,
          fileName: uploadedResult.fileName,
          mimeType: uploadedResult.mimeType,
          size: uploadedResult.size,
          uploadedBy: userId,
          entityType: undefined,
          entityId: undefined,
        },
      });
      expect(result).toEqual(createdRecord);
    });

    it('should pass entityType and entityId when provided', async () => {
      const uploadedResult = {
        key: 'employee_document/uuid.pdf',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        size: 12345,
      };
      storageService.upload.mockResolvedValue(uploadedResult);
      prisma.upload.create.mockResolvedValue({ id: 'upload-2', ...uploadedResult });

      await service.upload(mockFile, tenantId, userId, 'employee_document', 'emp-1');

      expect(storageService.upload).toHaveBeenCalledWith(mockFile, 'employee_document', 'emp-1');
      expect(prisma.upload.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'employee_document',
          entityId: 'emp-1',
        }),
      });
    });
  });

  // ============================
  // findByKey()
  // ============================
  describe('findByKey', () => {
    it('should return the upload when found', async () => {
      const upload = { id: 'upload-1', key: 'general/file.pdf', tenantId: 'tenant-1' };
      prisma.upload.findFirst.mockResolvedValue(upload);

      const result = await service.findByKey('general/file.pdf', 'tenant-1');

      expect(prisma.upload.findFirst).toHaveBeenCalledWith({
        where: { key: 'general/file.pdf', tenantId: 'tenant-1' },
      });
      expect(result).toEqual(upload);
    });

    it('should throw NotFoundException when upload not found', async () => {
      prisma.upload.findFirst.mockResolvedValue(null);

      await expect(service.findByKey('missing-key', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================
  // getFilePath()
  // ============================
  describe('getFilePath', () => {
    it('should return file path for existing upload', async () => {
      prisma.upload.findFirst.mockResolvedValue({
        id: 'upload-1',
        key: 'general/file.pdf',
        tenantId: 'tenant-1',
      });
      storageService.getFilePath.mockResolvedValue('/uploads/general/file.pdf');

      const result = await service.getFilePath('general/file.pdf', 'tenant-1');

      expect(result).toBe('/uploads/general/file.pdf');
      expect(storageService.getFilePath).toHaveBeenCalledWith('general/file.pdf');
    });

    it('should throw NotFoundException when upload record not found', async () => {
      prisma.upload.findFirst.mockResolvedValue(null);

      await expect(service.getFilePath('missing-key', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================
  // delete()
  // ============================
  describe('delete', () => {
    it('should delete upload when user is the uploader', async () => {
      const upload = {
        id: 'upload-1',
        key: 'general/file.pdf',
        tenantId: 'tenant-1',
        uploadedBy: 'user-1',
      };
      prisma.upload.findFirst.mockResolvedValue(upload);
      storageService.delete.mockResolvedValue(undefined);
      prisma.upload.delete.mockResolvedValue(upload);

      await service.delete('general/file.pdf', 'tenant-1', 'user-1');

      expect(storageService.delete).toHaveBeenCalledWith('general/file.pdf');
      expect(prisma.upload.delete).toHaveBeenCalledWith({ where: { id: 'upload-1' } });
    });

    it('should throw ForbiddenException when user is not the uploader', async () => {
      const upload = {
        id: 'upload-1',
        key: 'general/file.pdf',
        tenantId: 'tenant-1',
        uploadedBy: 'user-1',
      };
      prisma.upload.findFirst.mockResolvedValue(upload);

      await expect(
        service.delete('general/file.pdf', 'tenant-1', 'other-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when upload not found', async () => {
      prisma.upload.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('missing-key', 'tenant-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================
  // deleteByAdmin()
  // ============================
  describe('deleteByAdmin', () => {
    it('should delete upload regardless of uploader', async () => {
      const upload = {
        id: 'upload-1',
        key: 'general/file.pdf',
        tenantId: 'tenant-1',
        uploadedBy: 'other-user',
      };
      prisma.upload.findFirst.mockResolvedValue(upload);
      storageService.delete.mockResolvedValue(undefined);
      prisma.upload.delete.mockResolvedValue(upload);

      await service.deleteByAdmin('general/file.pdf', 'tenant-1');

      expect(storageService.delete).toHaveBeenCalledWith('general/file.pdf');
      expect(prisma.upload.delete).toHaveBeenCalledWith({ where: { id: 'upload-1' } });
    });

    it('should throw NotFoundException when upload not found', async () => {
      prisma.upload.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteByAdmin('missing-key', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
