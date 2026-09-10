import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { ProofsController } from './proofs.controller';
import { ProofsService } from './proofs.service';
import { StorageService } from '../../../common/storage/storage.service';
import {
  mockEmployee,
  mockHrAdmin,
  mockManager,
} from '../../../test/helpers';

function mockResponse() {
  return {
    setHeader: jest.fn(),
    sendFile: jest.fn(),
  } as unknown as Response & { setHeader: jest.Mock; sendFile: jest.Mock };
}

const UPLOAD = {
  id: 'upload-1',
  key: 'proofs/abc.pdf',
  fileName: '80c-receipt.pdf',
  mimeType: 'application/pdf',
};

describe('ProofsController', () => {
  let controller: ProofsController;
  let service: jest.Mocked<ProofsService>;
  let storage: jest.Mocked<StorageService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProofsController],
      providers: [
        {
          provide: ProofsService,
          useValue: {
            submit: jest.fn().mockResolvedValue({ id: 'proof-1' }),
            listMine: jest.fn().mockResolvedValue([]),
            summary: jest.fn().mockResolvedValue({ rows: [] }),
            withdraw: jest.fn().mockResolvedValue({ id: 'proof-1' }),
            fileFor: jest.fn().mockResolvedValue(UPLOAD),
            list: jest.fn().mockResolvedValue([]),
            approve: jest.fn().mockResolvedValue({ id: 'proof-1' }),
            reject: jest.fn().mockResolvedValue({ id: 'proof-1' }),
          },
        },
        {
          provide: StorageService,
          useValue: {
            getFilePath: jest.fn().mockResolvedValue('/var/uploads/proofs/abc.pdf'),
          },
        },
      ],
    }).compile();

    controller = module.get(ProofsController);
    service = module.get(ProofsService);
    storage = module.get(StorageService);
  });

  describe('employee routes', () => {
    it('files a proof against the identity on the token, never one from the body', async () => {
      await controller.submit(mockEmployee, {
        financialYear: 2026,
        section: 'SECTION_80C',
        claimedAmount: 50000,
        uploadId: 'upload-1',
      } as never);

      expect(service.submit).toHaveBeenCalledWith(
        mockEmployee.tenantId,
        mockEmployee.employeeId,
        mockEmployee.userId,
        expect.objectContaining({ uploadId: 'upload-1' }),
      );
    });

    it('lists only the proofs of the caller', async () => {
      await controller.listMine(mockEmployee, { financialYear: 2026 });

      expect(service.listMine).toHaveBeenCalledWith(
        mockEmployee.tenantId,
        mockEmployee.employeeId,
        2026,
      );
    });

    it('summarises only the caller own year', async () => {
      await controller.mySummary(mockEmployee, { financialYear: 2026 });

      expect(service.summary).toHaveBeenCalledWith(
        mockEmployee.tenantId,
        mockEmployee.employeeId,
        2026,
      );
    });

    it('withdraws against the caller own employee id', async () => {
      await controller.withdraw(mockEmployee, 'proof-1');

      expect(service.withdraw).toHaveBeenCalledWith(
        mockEmployee.tenantId,
        mockEmployee.employeeId,
        'proof-1',
      );
    });
  });

  describe('download', () => {
    it('streams the stored file under its original name and type', async () => {
      const res = mockResponse();

      await controller.downloadFile(mockEmployee, 'proof-1', res);

      expect(service.fileFor).toHaveBeenCalledWith(
        mockEmployee.tenantId,
        'proof-1',
        { employeeId: mockEmployee.employeeId, isPayrollStaff: false },
      );
      // The path comes from the stored key, never from anything the caller sent.
      expect(storage.getFilePath).toHaveBeenCalledWith('proofs/abc.pdf');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="80c-receipt.pdf"',
      );
      expect(res.sendFile).toHaveBeenCalledWith('/var/uploads/proofs/abc.pdf');
    });

    it('treats an HR administrator as payroll staff', async () => {
      await controller.downloadFile(mockHrAdmin, 'proof-1', mockResponse());

      expect(service.fileFor).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        'proof-1',
        { employeeId: mockHrAdmin.employeeId, isPayrollStaff: true },
      );
    });

    it('does not treat a manager as payroll staff: a subordinate tax affairs are not theirs', async () => {
      await controller.downloadFile(mockManager, 'proof-1', mockResponse());

      expect(service.fileFor).toHaveBeenCalledWith(
        mockManager.tenantId,
        'proof-1',
        { employeeId: mockManager.employeeId, isPayrollStaff: false },
      );
    });
  });

  describe('payroll staff routes', () => {
    it('passes the review queue filters through, on the caller own tenant', async () => {
      await controller.list(mockHrAdmin, {
        financialYear: 2026,
        status: 'PENDING' as never,
        employeeId: 'emp-1',
      });

      expect(service.list).toHaveBeenCalledWith(mockHrAdmin.tenantId, {
        financialYear: 2026,
        status: 'PENDING',
        employeeId: 'emp-1',
      });
    });

    it('summarises a named employee', async () => {
      await controller.employeeSummary(mockHrAdmin, 'emp-1', { financialYear: 2026 });

      expect(service.summary).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        'emp-1',
        2026,
      );
    });

    it('records the reviewer identity on an approval', async () => {
      await controller.approve(mockHrAdmin, 'proof-1', { verifiedAmount: 100 });

      expect(service.approve).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        mockHrAdmin.userId,
        'proof-1',
        { verifiedAmount: 100 },
      );
    });

    it('records the reviewer identity on a rejection', async () => {
      await controller.reject(mockHrAdmin, 'proof-1', { reviewNote: 'illegible' });

      expect(service.reject).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        mockHrAdmin.userId,
        'proof-1',
        { reviewNote: 'illegible' },
      );
    });
  });
});
