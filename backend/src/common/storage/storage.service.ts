import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface UploadedFile {
  key: string;
  fileName: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageType: string;
  private readonly localPath: string;

  constructor(private configService: ConfigService) {
    this.storageType = this.configService.get<string>('STORAGE_TYPE', 'local');
    this.localPath = this.configService.get<string>(
      'STORAGE_LOCAL_PATH',
      './uploads',
    );

    if (this.storageType === 'local') {
      this.ensureLocalDirectory();
    }
  }

  private ensureLocalDirectory(): void {
    const absolutePath = path.resolve(this.localPath);
    if (!fs.existsSync(absolutePath)) {
      fs.mkdirSync(absolutePath, { recursive: true });
      this.logger.log(`Created local storage directory: ${absolutePath}`);
    }
  }

  private assertPathWithinBoundary(resolvedPath: string): void {
    const boundary = path.resolve(this.localPath);
    if (!resolvedPath.startsWith(boundary + path.sep) && resolvedPath !== boundary) {
      throw new BadRequestException('Invalid file path: path traversal detected');
    }
  }

  async upload(
    file: Express.Multer.File,
    entityType?: string,
    entityId?: string,
  ): Promise<UploadedFile> {
    const ext = path.extname(file.originalname);
    const key = `${entityType || 'general'}/${uuidv4()}${ext}`;

    if (this.storageType === 'local') {
      return this.uploadLocal(file, key);
    }

    // S3 upload can be added here later
    return this.uploadLocal(file, key);
  }

  private async uploadLocal(
    file: Express.Multer.File,
    key: string,
  ): Promise<UploadedFile> {
    const filePath = path.resolve(this.localPath, key);
    this.assertPathWithinBoundary(filePath);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, file.buffer);

    this.logger.debug(`File uploaded locally: ${key}`);

    return {
      key,
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  async getFilePath(key: string): Promise<string> {
    if (this.storageType === 'local') {
      const filePath = path.resolve(this.localPath, key);
      this.assertPathWithinBoundary(filePath);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${key}`);
      }
      return filePath;
    }

    throw new Error(`Storage type ${this.storageType} not supported for getFilePath`);
  }

  async delete(key: string): Promise<void> {
    if (this.storageType === 'local') {
      const filePath = path.resolve(this.localPath, key);
      this.assertPathWithinBoundary(filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.debug(`File deleted: ${key}`);
      }
      return;
    }

    this.logger.warn(`Delete not implemented for storage type: ${this.storageType}`);
  }
}
