import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getDocuments: jest.fn(),
  uploadDocument: jest.fn(),
  getDocumentById: jest.fn(),
  downloadDocument: jest.fn(),
  verifyDocument: jest.fn(),
  deleteDocument: jest.fn(),
};

describe('DocumentsController', () => {
  let controller: DocumentsController;
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

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: mockService }],
    }).compile();
    controller = module.get<DocumentsController>(DocumentsController);
    service = module.get(DocumentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // getDocuments
  // ============================================
  describe('getDocuments', () => {
    it('should return documents for admin accessing any employee', async () => {
      const expected = [{ id: 'doc-1' }];
      service.getDocuments.mockResolvedValue(expected);

      const result = await controller.getDocuments(adminUser, 'emp-99', {});

      expect(result).toEqual(expected);
      expect(service.getDocuments).toHaveBeenCalledWith(
        adminUser.tenantId,
        'emp-99',
        {},
      );
    });

    it('should allow employees to access own documents', async () => {
      service.getDocuments.mockResolvedValue([]);

      await controller.getDocuments(employeeUser, 'emp-2', {});

      expect(service.getDocuments).toHaveBeenCalledWith(
        employeeUser.tenantId,
        'emp-2',
        {},
      );
    });

    it('should throw ForbiddenException for employee accessing other documents', async () => {
      await expect(
        controller.getDocuments(employeeUser, 'emp-99', {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================
  // uploadDocument
  // ============================================
  describe('uploadDocument', () => {
    const mockFile = {
      originalname: 'test.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('data'),
      size: 1024,
    } as Express.Multer.File;

    const dto = { name: 'Test Document' };

    it('should upload document for admin', async () => {
      const expected = { id: 'doc-1' };
      service.uploadDocument.mockResolvedValue(expected);

      const result = await controller.uploadDocument(
        adminUser,
        'emp-99',
        mockFile,
        dto,
      );

      expect(result).toEqual(expected);
      expect(service.uploadDocument).toHaveBeenCalledWith(
        adminUser.tenantId,
        'emp-99',
        mockFile,
        dto,
        adminUser.userId,
      );
    });

    it('should throw BadRequestException when file is missing', async () => {
      await expect(
        controller.uploadDocument(adminUser, 'emp-1', null as any, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException for employee uploading to other profile', async () => {
      await expect(
        controller.uploadDocument(employeeUser, 'emp-99', mockFile, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow employee to upload to own profile', async () => {
      service.uploadDocument.mockResolvedValue({ id: 'doc-2' });

      const result = await controller.uploadDocument(
        employeeUser,
        'emp-2',
        mockFile,
        dto,
      );

      expect(result).toEqual({ id: 'doc-2' });
    });
  });

  // ============================================
  // getDocument
  // ============================================
  describe('getDocument', () => {
    it('should return a single document for admin', async () => {
      const expected = { id: 'doc-1', name: 'Test' };
      service.getDocumentById.mockResolvedValue(expected);

      const result = await controller.getDocument(adminUser, 'emp-1', 'doc-1');

      expect(result).toEqual(expected);
      expect(service.getDocumentById).toHaveBeenCalledWith(
        adminUser.tenantId,
        'doc-1',
      );
    });

    it('should throw ForbiddenException for employee accessing other docs', async () => {
      await expect(
        controller.getDocument(employeeUser, 'emp-99', 'doc-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================
  // downloadDocument
  // ============================================
  describe('downloadDocument', () => {
    const mockRes = {
      setHeader: jest.fn(),
      sendFile: jest.fn(),
    } as any;

    it('should set headers and send the file', async () => {
      service.downloadDocument.mockResolvedValue({
        filePath: '/path/to/file.pdf',
        fileName: 'file.pdf',
        mimeType: 'application/pdf',
      });

      await controller.downloadDocument(adminUser, 'emp-1', 'doc-1', mockRes);

      expect(service.downloadDocument).toHaveBeenCalledWith(
        adminUser.tenantId,
        'doc-1',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="file.pdf"',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(mockRes.sendFile).toHaveBeenCalledWith('/path/to/file.pdf');
    });

    it('should throw ForbiddenException for employee accessing other downloads', async () => {
      await expect(
        controller.downloadDocument(employeeUser, 'emp-99', 'doc-1', mockRes),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================
  // verifyDocument
  // ============================================
  describe('verifyDocument', () => {
    it('should verify a document using employeeId', async () => {
      const expected = { id: 'doc-1', verified: true };
      service.verifyDocument.mockResolvedValue(expected);

      const result = await controller.verifyDocument(adminUser, 'doc-1');

      expect(result).toEqual(expected);
      expect(service.verifyDocument).toHaveBeenCalledWith(
        adminUser.tenantId,
        'doc-1',
        adminUser.employeeId,
      );
    });

    it('should fallback to userId when employeeId is not present', async () => {
      const userNoEmployee: AuthenticatedUser = {
        ...adminUser,
        employeeId: undefined,
      };
      service.verifyDocument.mockResolvedValue({ id: 'doc-1' });

      await controller.verifyDocument(userNoEmployee, 'doc-1');

      expect(service.verifyDocument).toHaveBeenCalledWith(
        userNoEmployee.tenantId,
        'doc-1',
        userNoEmployee.userId,
      );
    });
  });

  // ============================================
  // deleteDocument
  // ============================================
  describe('deleteDocument', () => {
    it('should delete a document', async () => {
      const expected = { id: 'doc-1', deleted: true };
      service.deleteDocument.mockResolvedValue(expected);

      const result = await controller.deleteDocument(adminUser, 'doc-1');

      expect(result).toEqual(expected);
      expect(service.deleteDocument).toHaveBeenCalledWith(
        adminUser.tenantId,
        'doc-1',
      );
    });
  });
});
