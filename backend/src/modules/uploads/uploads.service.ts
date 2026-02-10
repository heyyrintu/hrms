import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class UploadsService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async upload(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
    entityType?: string,
    entityId?: string,
  ) {
    const uploaded = await this.storageService.upload(
      file,
      entityType,
      entityId,
    );

    const record = await this.prisma.upload.create({
      data: {
        tenantId,
        key: uploaded.key,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        size: uploaded.size,
        uploadedBy: userId,
        entityType,
        entityId,
      },
    });

    return record;
  }

  async findByKey(key: string, tenantId: string) {
    const upload = await this.prisma.upload.findFirst({
      where: { key, tenantId },
    });

    if (!upload) {
      throw new NotFoundException('File not found');
    }

    return upload;
  }

  async getFilePath(key: string, tenantId: string): Promise<string> {
    await this.findByKey(key, tenantId);
    return this.storageService.getFilePath(key);
  }

  async delete(key: string, tenantId: string, userId: string) {
    const upload = await this.findByKey(key, tenantId);

    // Only the uploader or admins can delete (admin check is done at controller level via @Roles)
    if (upload.uploadedBy !== userId) {
      throw new ForbiddenException('You can only delete your own uploads');
    }

    await this.storageService.delete(key);
    await this.prisma.upload.delete({ where: { id: upload.id } });
  }

  async deleteByAdmin(key: string, tenantId: string) {
    const upload = await this.findByKey(key, tenantId);
    await this.storageService.delete(key);
    await this.prisma.upload.delete({ where: { id: upload.id } });
  }
}
