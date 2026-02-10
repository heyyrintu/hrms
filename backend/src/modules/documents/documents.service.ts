import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { CreateDocumentDto, DocumentQueryDto } from './dto/document.dto';
import { DocumentCategory } from '@prisma/client';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async uploadDocument(
    tenantId: string,
    employeeId: string,
    file: Express.Multer.File,
    dto: CreateDocumentDto,
    uploadedBy: string,
  ) {
    // Verify employee exists in tenant
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Upload file via storage service
    const uploaded = await this.storageService.upload(
      file,
      'employee_document',
      employeeId,
    );

    // Create upload record
    const uploadRecord = await this.prisma.upload.create({
      data: {
        tenantId,
        key: uploaded.key,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        size: uploaded.size,
        uploadedBy,
        entityType: 'employee_document',
        entityId: employeeId,
      },
    });

    // Create document record
    return this.prisma.employeeDocument.create({
      data: {
        tenantId,
        employeeId,
        uploadId: uploadRecord.id,
        name: dto.name,
        category: dto.category || DocumentCategory.OTHER,
        documentDate: dto.documentDate ? new Date(dto.documentDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      },
      include: {
        upload: { select: { fileName: true, mimeType: true, size: true, key: true } },
      },
    });
  }

  async getDocuments(
    tenantId: string,
    employeeId: string,
    query?: DocumentQueryDto,
  ) {
    return this.prisma.employeeDocument.findMany({
      where: {
        tenantId,
        employeeId,
        ...(query?.category ? { category: query.category } : {}),
      },
      include: {
        upload: { select: { fileName: true, mimeType: true, size: true, key: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocumentById(tenantId: string, docId: string) {
    const doc = await this.prisma.employeeDocument.findFirst({
      where: { id: docId, tenantId },
      include: {
        upload: { select: { fileName: true, mimeType: true, size: true, key: true } },
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
      },
    });

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    return doc;
  }

  async downloadDocument(tenantId: string, docId: string) {
    const doc = await this.getDocumentById(tenantId, docId);
    const filePath = await this.storageService.getFilePath(doc.upload.key);
    return { filePath, fileName: doc.upload.fileName, mimeType: doc.upload.mimeType };
  }

  async verifyDocument(
    tenantId: string,
    docId: string,
    verifiedBy: string,
  ) {
    const doc = await this.getDocumentById(tenantId, docId);

    return this.prisma.employeeDocument.update({
      where: { id: doc.id },
      data: {
        isVerified: true,
        verifiedBy,
        verifiedAt: new Date(),
      },
      include: {
        upload: { select: { fileName: true, mimeType: true, size: true, key: true } },
      },
    });
  }

  async deleteDocument(tenantId: string, docId: string) {
    const doc = await this.getDocumentById(tenantId, docId);

    // Delete file from storage
    try {
      await this.storageService.delete(doc.upload.key);
    } catch {
      // File may already be deleted, continue
    }

    // Delete records
    await this.prisma.employeeDocument.delete({ where: { id: doc.id } });
    await this.prisma.upload.delete({ where: { id: doc.uploadId } });

    return { message: 'Document deleted' };
  }
}
