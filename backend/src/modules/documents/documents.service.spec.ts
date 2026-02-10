import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
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

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: any;
  let storageService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: StorageService, useValue: createMockStorageService() },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    prisma = module.get(PrismaService);
    storageService = module.get(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================
  // uploadDocument()
  // ============================
  describe('uploadDocument', () => {
    const tenantId = 'tenant-1';
    const employeeId = 'emp-1';
    const uploadedBy = 'user-1';
    const mockFile = {
      originalname: 'id-card.pdf',
      mimetype: 'application/pdf',
      size: 5000,
      buffer: Buffer.from('file'),
    } as Express.Multer.File;
    const dto = { name: 'ID Card', category: 'IDENTITY' as any };

    it('should upload document successfully', async () => {
      const employee = { id: employeeId, tenantId };
      prisma.employee.findFirst.mockResolvedValue(employee);

      const uploaded = {
        key: 'employee_document/uuid.pdf',
        fileName: 'id-card.pdf',
        mimeType: 'application/pdf',
        size: 5000,
      };
      storageService.upload.mockResolvedValue(uploaded);

      const uploadRecord = { id: 'upload-1', ...uploaded, tenantId, uploadedBy };
      prisma.upload.create.mockResolvedValue(uploadRecord);

      const docRecord = {
        id: 'doc-1',
        tenantId,
        employeeId,
        uploadId: 'upload-1',
        name: dto.name,
        category: dto.category,
        upload: { fileName: uploaded.fileName, mimeType: uploaded.mimeType, size: uploaded.size, key: uploaded.key },
      };
      prisma.employeeDocument.create.mockResolvedValue(docRecord);

      const result = await service.uploadDocument(tenantId, employeeId, mockFile, dto, uploadedBy);

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: employeeId, tenantId },
      });
      expect(storageService.upload).toHaveBeenCalledWith(mockFile, 'employee_document', employeeId);
      expect(prisma.upload.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          key: uploaded.key,
          uploadedBy,
          entityType: 'employee_document',
          entityId: employeeId,
        }),
      });
      expect(prisma.employeeDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          employeeId,
          uploadId: 'upload-1',
          name: dto.name,
        }),
        include: {
          upload: { select: { fileName: true, mimeType: true, size: true, key: true } },
        },
      });
      expect(result).toEqual(docRecord);
    });

    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadDocument(tenantId, employeeId, mockFile, dto, uploadedBy),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle optional documentDate and expiryDate', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: employeeId, tenantId });
      storageService.upload.mockResolvedValue({
        key: 'k', fileName: 'f', mimeType: 'm', size: 1,
      });
      prisma.upload.create.mockResolvedValue({ id: 'upload-2' });
      prisma.employeeDocument.create.mockResolvedValue({ id: 'doc-2' });

      const dtoWithDates = {
        name: 'Passport',
        category: 'IDENTITY' as any,
        documentDate: '2024-01-15',
        expiryDate: '2034-01-15',
      };

      await service.uploadDocument(tenantId, employeeId, mockFile, dtoWithDates, uploadedBy);

      expect(prisma.employeeDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentDate: new Date('2024-01-15'),
          expiryDate: new Date('2034-01-15'),
        }),
        include: expect.any(Object),
      });
    });
  });

  // ============================
  // getDocuments()
  // ============================
  describe('getDocuments', () => {
    it('should return documents for an employee', async () => {
      const docs = [{ id: 'doc-1' }, { id: 'doc-2' }];
      prisma.employeeDocument.findMany.mockResolvedValue(docs);

      const result = await service.getDocuments('tenant-1', 'emp-1');

      expect(prisma.employeeDocument.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1' },
        include: {
          upload: { select: { fileName: true, mimeType: true, size: true, key: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(docs);
    });

    it('should filter by category when provided', async () => {
      prisma.employeeDocument.findMany.mockResolvedValue([]);

      await service.getDocuments('tenant-1', 'emp-1', { category: 'IDENTITY' as any });

      expect(prisma.employeeDocument.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1', category: 'IDENTITY' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  // ============================
  // getDocumentById()
  // ============================
  describe('getDocumentById', () => {
    it('should return a document by id', async () => {
      const doc = {
        id: 'doc-1',
        tenantId: 'tenant-1',
        upload: { fileName: 'f.pdf', mimeType: 'application/pdf', size: 100, key: 'k' },
        employee: { firstName: 'John', lastName: 'Doe', employeeCode: 'E001' },
      };
      prisma.employeeDocument.findFirst.mockResolvedValue(doc);

      const result = await service.getDocumentById('tenant-1', 'doc-1');

      expect(prisma.employeeDocument.findFirst).toHaveBeenCalledWith({
        where: { id: 'doc-1', tenantId: 'tenant-1' },
        include: {
          upload: { select: { fileName: true, mimeType: true, size: true, key: true } },
          employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        },
      });
      expect(result).toEqual(doc);
    });

    it('should throw NotFoundException when document not found', async () => {
      prisma.employeeDocument.findFirst.mockResolvedValue(null);

      await expect(service.getDocumentById('tenant-1', 'missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================
  // downloadDocument()
  // ============================
  describe('downloadDocument', () => {
    it('should return filePath, fileName, and mimeType', async () => {
      const doc = {
        id: 'doc-1',
        upload: { key: 'docs/file.pdf', fileName: 'file.pdf', mimeType: 'application/pdf', size: 100 },
        employee: { firstName: 'John', lastName: 'Doe', employeeCode: 'E001' },
      };
      prisma.employeeDocument.findFirst.mockResolvedValue(doc);
      storageService.getFilePath.mockResolvedValue('/uploads/docs/file.pdf');

      const result = await service.downloadDocument('tenant-1', 'doc-1');

      expect(result).toEqual({
        filePath: '/uploads/docs/file.pdf',
        fileName: 'file.pdf',
        mimeType: 'application/pdf',
      });
      expect(storageService.getFilePath).toHaveBeenCalledWith('docs/file.pdf');
    });

    it('should throw NotFoundException when document not found', async () => {
      prisma.employeeDocument.findFirst.mockResolvedValue(null);

      await expect(service.downloadDocument('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================
  // verifyDocument()
  // ============================
  describe('verifyDocument', () => {
    it('should verify a document', async () => {
      const doc = {
        id: 'doc-1',
        upload: { fileName: 'f', mimeType: 'm', size: 1, key: 'k' },
        employee: { firstName: 'J', lastName: 'D', employeeCode: 'E1' },
      };
      prisma.employeeDocument.findFirst.mockResolvedValue(doc);

      const updated = { ...doc, isVerified: true, verifiedBy: 'admin-1' };
      prisma.employeeDocument.update.mockResolvedValue(updated);

      const result = await service.verifyDocument('tenant-1', 'doc-1', 'admin-1');

      expect(prisma.employeeDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          isVerified: true,
          verifiedBy: 'admin-1',
          verifiedAt: expect.any(Date),
        },
        include: {
          upload: { select: { fileName: true, mimeType: true, size: true, key: true } },
        },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when document not found', async () => {
      prisma.employeeDocument.findFirst.mockResolvedValue(null);

      await expect(service.verifyDocument('tenant-1', 'missing', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================
  // deleteDocument()
  // ============================
  describe('deleteDocument', () => {
    it('should delete document and upload records', async () => {
      const doc = {
        id: 'doc-1',
        uploadId: 'upload-1',
        upload: { key: 'docs/file.pdf', fileName: 'f', mimeType: 'm', size: 1 },
        employee: { firstName: 'J', lastName: 'D', employeeCode: 'E1' },
      };
      prisma.employeeDocument.findFirst.mockResolvedValue(doc);
      storageService.delete.mockResolvedValue(undefined);
      prisma.employeeDocument.delete.mockResolvedValue(doc);
      prisma.upload.delete.mockResolvedValue({});

      const result = await service.deleteDocument('tenant-1', 'doc-1');

      expect(storageService.delete).toHaveBeenCalledWith('docs/file.pdf');
      expect(prisma.employeeDocument.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
      expect(prisma.upload.delete).toHaveBeenCalledWith({ where: { id: 'upload-1' } });
      expect(result).toEqual({ message: 'Document deleted' });
    });

    it('should continue even if storage delete fails', async () => {
      const doc = {
        id: 'doc-1',
        uploadId: 'upload-1',
        upload: { key: 'docs/file.pdf', fileName: 'f', mimeType: 'm', size: 1 },
        employee: { firstName: 'J', lastName: 'D', employeeCode: 'E1' },
      };
      prisma.employeeDocument.findFirst.mockResolvedValue(doc);
      storageService.delete.mockRejectedValue(new Error('File already deleted'));
      prisma.employeeDocument.delete.mockResolvedValue(doc);
      prisma.upload.delete.mockResolvedValue({});

      const result = await service.deleteDocument('tenant-1', 'doc-1');

      expect(prisma.employeeDocument.delete).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Document deleted' });
    });

    it('should throw NotFoundException when document not found', async () => {
      prisma.employeeDocument.findFirst.mockResolvedValue(null);

      await expect(service.deleteDocument('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
