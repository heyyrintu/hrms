import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EXCEPTION_FILTERS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { mockHrAdmin } from '../../../test/helpers';
import { EmployeeImportController } from './employee-import.controller';
import { EmployeeImportService } from './employee-import.service';
import { MulterExceptionFilter } from './multer-error.filter';
import {
  EMPLOYEE_IMPORT_TEMPLATE,
  IMPORT_COLUMNS,
  MAX_IMPORT_FILE_SIZE,
} from './dto/import-employees.dto';

function fakeFile(body: string, size = Buffer.byteLength(body)): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'employees.csv',
    mimetype: 'text/csv',
    buffer: Buffer.from(body),
    size,
  } as Express.Multer.File;
}

describe('EmployeeImportController', () => {
  let controller: EmployeeImportController;
  let service: { importFromCsv: jest.Mock };

  beforeEach(async () => {
    service = {
      importFromCsv: jest.fn().mockResolvedValue({
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        errors: [],
        created: 1,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmployeeImportController],
      providers: [{ provide: EmployeeImportService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(EmployeeImportController);
  });

  describe('authorization metadata', () => {
    it('restricts both routes to HR_ADMIN and SUPER_ADMIN', () => {
      const reflector = new Reflector();
      for (const handler of [
        EmployeeImportController.prototype.import,
        EmployeeImportController.prototype.getTemplate,
      ]) {
        expect(reflector.get(ROLES_KEY, handler)).toEqual([
          UserRole.HR_ADMIN,
          UserRole.SUPER_ADMIN,
        ]);
      }
    });
  });

  describe('multer error handling', () => {
    it('applies the multer exception filter to the upload endpoint', () => {
      // Without this the interceptor's own abort (oversized file) escapes as a
      // 500, because the backend installs no global exception filter.
      const filters = Reflect.getMetadata(
        EXCEPTION_FILTERS_METADATA,
        EmployeeImportController.prototype.import,
      );
      expect(filters).toEqual([MulterExceptionFilter]);
    });
  });

  describe('GET template', () => {
    it('sends the header line as a CSV attachment', () => {
      const res: any = { setHeader: jest.fn(), send: jest.fn() };
      controller.getTemplate(res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="employee-import-template.csv"',
      );
      expect(res.send).toHaveBeenCalledWith(EMPLOYEE_IMPORT_TEMPLATE);
      expect(EMPLOYEE_IMPORT_TEMPLATE.trim().split(',')).toEqual([...IMPORT_COLUMNS]);
    });
  });

  describe('POST import', () => {
    it('passes the decoded file, tenant and user through to the service', async () => {
      const result = await controller.import(
        fakeFile('employeeCode\nE1'),
        { initialPassword: 'initial-secret' },
        { dryRun: false },
        mockHrAdmin,
      );

      expect(service.importFromCsv).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        mockHrAdmin.userId,
        'employeeCode\nE1',
        { dryRun: false, initialPassword: 'initial-secret' },
      );
      expect(result).toMatchObject({ created: 1 });
    });

    it('treats dryRun=true as a dry run', async () => {
      await controller.import(fakeFile('a'), {}, { dryRun: true }, mockHrAdmin);
      expect(service.importFromCsv.mock.calls[0][3]).toEqual({
        dryRun: true,
        initialPassword: undefined,
      });
    });

    it('treats a missing dryRun query param as a real import', async () => {
      await controller.import(fakeFile('a'), { initialPassword: 'initial-secret' }, {}, mockHrAdmin);
      expect(service.importFromCsv.mock.calls[0][3].dryRun).toBe(false);
    });

    it('rejects a request with no file', async () => {
      await expect(
        controller.import(undefined as never, {}, { dryRun: true }, mockHrAdmin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.importFromCsv).not.toHaveBeenCalled();
    });

    it('rejects a file larger than 2 MB', async () => {
      await expect(
        controller.import(
          fakeFile('a', MAX_IMPORT_FILE_SIZE + 1),
          {},
          { dryRun: true },
          mockHrAdmin,
        ),
      ).rejects.toThrow(/larger than 2 MB/);
      expect(service.importFromCsv).not.toHaveBeenCalled();
    });
  });
});
