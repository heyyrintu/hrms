import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AttendanceCaptureService } from './attendance-capture.service';
import { createMockPrismaService } from '../../../test/helpers';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

describe('AttendanceCaptureService', () => {
  const tenantId = 'tenant-1';
  let prisma: any;
  let policyService: { getOrCreate: jest.Mock };
  let uploads: { upload: jest.Mock; getFilePath: jest.Mock };
  let requests: { findApprovedCovering: jest.Mock };
  let attendance: { currentShiftDate: jest.Mock };
  let service: AttendanceCaptureService;

  const employee: AuthenticatedUser = {
    userId: 'user-emp',
    email: 'e@test.com',
    tenantId,
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };
  const manager: AuthenticatedUser = {
    ...employee,
    userId: 'user-mgr',
    role: UserRole.MANAGER,
    employeeId: 'emp-mgr',
  };
  const hr: AuthenticatedUser = { ...manager, role: UserRole.HR_ADMIN, employeeId: 'emp-hr' };

  const file = (over: Record<string, unknown> = {}) =>
    ({ mimetype: 'image/jpeg', size: 1024, originalname: 's.jpg', buffer: Buffer.from('x'), ...over }) as any;

  beforeEach(() => {
    prisma = createMockPrismaService();
    policyService = {
      getOrCreate: jest.fn().mockResolvedValue({
        ipRestrictionEnabled: true,
        allowedIpRanges: ['10.0.0.0/8'],
        selfieRequired: true,
      }),
    };
    uploads = {
      upload: jest.fn().mockResolvedValue({ id: 'up-1' }),
      getFilePath: jest.fn().mockResolvedValue('/files/attendance-selfie/x.jpg'),
    };
    requests = { findApprovedCovering: jest.fn().mockResolvedValue(null) };
    attendance = {
      currentShiftDate: jest.fn().mockResolvedValue(new Date('2026-03-17T00:00:00.000Z')),
    };
    service = new AttendanceCaptureService(
      prisma,
      policyService as any,
      uploads as any,
      requests as any,
      attendance as any,
    );
  });

  describe('getPolicyStatus', () => {
    it('reports the policy, the IP verdict and the client IP', async () => {
      await expect(service.getPolicyStatus(employee, '10.1.2.3')).resolves.toEqual({
        ipRestrictionEnabled: true,
        ipAllowed: true,
        selfieRequired: true,
        coveringRequest: null,
        clientIp: '10.1.2.3',
      });
      await expect(service.getPolicyStatus(employee, '198.51.100.9')).resolves.toMatchObject({
        ipAllowed: false,
      });
      await expect(service.getPolicyStatus(employee, undefined)).resolves.toMatchObject({
        ipAllowed: false,
        clientIp: null,
      });
    });

    it('computes the covering request for the CURRENT shift day (open night shift = yesterday)', async () => {
      requests.findApprovedCovering.mockResolvedValue({ id: 'req-1', type: 'WFH' });
      const res = await service.getPolicyStatus(employee, '10.1.2.3');
      expect(attendance.currentShiftDate).toHaveBeenCalledWith(tenantId, 'emp-1');
      expect(requests.findApprovedCovering).toHaveBeenCalledWith(
        tenantId,
        'emp-1',
        new Date('2026-03-17T00:00:00.000Z'),
      );
      expect(res.coveringRequest).toEqual({ id: 'req-1', type: 'WFH' });
    });

    it('400s when the user has no employee record', async () => {
      await expect(
        service.getPolicyStatus({ ...employee, employeeId: undefined }, '10.1.2.3'),
      ).rejects.toThrow('No employee record linked to this user');
    });
  });

  describe('uploadSelfie', () => {
    it('stores the image as an attendance-selfie and returns its id', async () => {
      await expect(service.uploadSelfie(employee, file())).resolves.toEqual({ uploadId: 'up-1' });
      expect(uploads.upload).toHaveBeenCalledWith(
        expect.objectContaining({ mimetype: 'image/jpeg' }),
        tenantId,
        'user-emp',
        'attendance-selfie',
      );
    });

    it.each(['image/png', 'image/webp'])('accepts %s', async (mimetype) => {
      await expect(service.uploadSelfie(employee, file({ mimetype }))).resolves.toBeDefined();
    });

    it('rejects a missing file', async () => {
      await expect(service.uploadSelfie(employee, undefined as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it.each(['application/pdf', 'image/gif', 'image/svg+xml', 'text/html'])(
      'rejects %s',
      async (mimetype) => {
        await expect(service.uploadSelfie(employee, file({ mimetype }))).rejects.toThrow(
          BadRequestException,
        );
        expect(uploads.upload).not.toHaveBeenCalled();
      },
    );

    it('rejects a file over 2 MB', async () => {
      await expect(
        service.uploadSelfie(employee, file({ size: 2 * 1024 * 1024 + 1 })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSelfie', () => {
    const session = (over: Record<string, unknown> = {}) => ({
      inSelfieUploadId: 'up-in',
      outSelfieUploadId: null,
      attendance: { employeeId: 'emp-1' },
      ...over,
    });

    beforeEach(() => {
      prisma.attendanceSession.findFirst.mockResolvedValue(session());
      prisma.upload.findFirst.mockResolvedValue({
        key: 'attendance-selfie/x.jpg',
        mimeType: 'image/jpeg',
      });
      prisma.employee.findFirst.mockResolvedValue(null);
    });

    it('lets the employee see their own selfie', async () => {
      await expect(service.getSelfie(employee, 's1', 'in')).resolves.toEqual({
        path: '/files/attendance-selfie/x.jpg',
        mimeType: 'image/jpeg',
      });
      expect(prisma.attendanceSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1', tenantId } }),
      );
      expect(prisma.upload.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'up-in', tenantId, entityType: 'attendance-selfie' },
        }),
      );
      expect(uploads.getFilePath).toHaveBeenCalledWith('attendance-selfie/x.jpg', tenantId);
    });

    it('lets HR see anyone', async () => {
      await expect(service.getSelfie(hr, 's1', 'in')).resolves.toBeDefined();
    });

    it('lets the direct manager see a report', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      await expect(service.getSelfie(manager, 's1', 'in')).resolves.toBeDefined();
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1', tenantId, managerId: 'emp-mgr' },
        }),
      );
    });

    it('404s for another employee and for a manager who is not the direct manager', async () => {
      await expect(
        service.getSelfie({ ...employee, employeeId: 'emp-9' }, 's1', 'in'),
      ).rejects.toThrow(NotFoundException);
      await expect(service.getSelfie(manager, 's1', 'in')).rejects.toThrow(NotFoundException);
    });

    it('404s for an employee-role caller with no employee id rather than matching undefined', async () => {
      await expect(
        service.getSelfie({ ...employee, employeeId: undefined }, 's1', 'in'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s when the session is missing or has no selfie for that side', async () => {
      prisma.attendanceSession.findFirst.mockResolvedValueOnce(null);
      await expect(service.getSelfie(employee, 'nope', 'in')).rejects.toThrow(NotFoundException);
      await expect(service.getSelfie(employee, 's1', 'out')).rejects.toThrow(NotFoundException);
    });

    it('serves the out selfie from outSelfieUploadId', async () => {
      prisma.attendanceSession.findFirst.mockResolvedValue(
        session({ outSelfieUploadId: 'up-out' }),
      );
      await service.getSelfie(employee, 's1', 'out');
      expect(prisma.upload.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'up-out' }) }),
      );
    });

    it('404s when the upload row is gone', async () => {
      prisma.upload.findFirst.mockResolvedValue(null);
      await expect(service.getSelfie(employee, 's1', 'in')).rejects.toThrow(NotFoundException);
    });
  });
});
