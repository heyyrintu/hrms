import { AttendanceCaptureController } from './attendance-capture.controller';
import { MulterExceptionFilter } from '../../employees/import/multer-error.filter';
import { MulterError } from 'multer';

describe('AttendanceCaptureController', () => {
  const user: any = { userId: 'u1', tenantId: 't1', role: 'EMPLOYEE', employeeId: 'e1' };
  let svc: Record<string, jest.Mock>;
  let controller: AttendanceCaptureController;

  beforeEach(() => {
    svc = {
      getPolicyStatus: jest.fn().mockResolvedValue({ ipAllowed: true }),
      uploadSelfie: jest.fn().mockResolvedValue({ uploadId: 'up-1' }),
      getSelfie: jest
        .fn()
        .mockResolvedValue({ path: '/files/a.jpg', mimeType: 'image/jpeg' }),
    };
    controller = new AttendanceCaptureController(svc as any);
  });

  it('maps the multer 2 MB limit error to 400 on the selfie route', () => {
    const filters = Reflect.getMetadata(
      '__exceptionFilters__',
      AttendanceCaptureController.prototype.uploadSelfie,
    );
    expect(filters).toContain(MulterExceptionFilter);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    new MulterExceptionFilter().catch(new MulterError('LIMIT_FILE_SIZE', 'file'), {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as any);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('passes the request IP to the policy status', async () => {
    await controller.getPolicy(user, { ip: '10.1.2.3' } as any);
    expect(svc.getPolicyStatus).toHaveBeenCalledWith(user, '10.1.2.3');
  });

  it('delegates the selfie upload', async () => {
    const file: any = { mimetype: 'image/jpeg' };
    await expect(controller.uploadSelfie(user, file)).resolves.toEqual({ uploadId: 'up-1' });
    expect(svc.uploadSelfie).toHaveBeenCalledWith(user, file);
  });

  it('streams a selfie inline, uncached', async () => {
    const res: any = { setHeader: jest.fn(), sendFile: jest.fn() };
    await controller.getSelfie(user, 's1', 'in' as any, res);
    expect(svc.getSelfie).toHaveBeenCalledWith(user, 's1', 'in');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline');
    expect(res.sendFile).toHaveBeenCalledWith('/files/a.jpg');
  });
});
