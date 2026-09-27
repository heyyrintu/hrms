import { mockHrAdmin } from '../../test/helpers';
import { RecruitmentSettingsController } from './recruitment-settings.controller';
import { PublicCareersController } from './public-careers.controller';
import { PreOnboardingController } from './pre-onboarding.controller';
import { PublicPreOnboardingController } from './public-pre-onboarding.controller';
import { RecruitmentReportsController } from './recruitment-reports.controller';

/**
 * Thin delegation tests for the WS-D3 controllers: each route calls the
 * right service method with the right arguments. The behavior itself is
 * covered by each service's own spec.
 */
describe('WS-D3 controllers delegate to their services', () => {
  it('RecruitmentSettingsController', async () => {
    const service = { get: jest.fn().mockResolvedValue('get'), update: jest.fn().mockResolvedValue('update') };
    const controller = new RecruitmentSettingsController(service as any);

    await controller.get(mockHrAdmin);
    expect(service.get).toHaveBeenCalledWith(mockHrAdmin.tenantId);

    await controller.update(mockHrAdmin, { careersPageEnabled: true } as any);
    expect(service.update).toHaveBeenCalledWith(mockHrAdmin.tenantId, { careersPageEnabled: true });
  });

  it('PublicCareersController', async () => {
    const service = {
      getCareers: jest.fn().mockResolvedValue('careers'),
      getJob: jest.fn().mockResolvedValue('job'),
      apply: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    const controller = new PublicCareersController(service as any);

    await controller.getCareers('acme');
    expect(service.getCareers).toHaveBeenCalledWith('acme');

    await controller.getJob('acme', 'swe-1');
    expect(service.getJob).toHaveBeenCalledWith('acme', 'swe-1');

    const dto = { firstName: 'A', lastName: 'B', email: 'a@b.com' } as any;
    const file = { originalname: 'r.pdf' } as any;
    await controller.apply('acme', 'swe-1', dto, file);
    expect(service.apply).toHaveBeenCalledWith('acme', 'swe-1', dto, file);
  });

  it('PreOnboardingController', async () => {
    const service = {
      create: jest.fn().mockResolvedValue('created'),
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue('one'),
      revoke: jest.fn().mockResolvedValue('revoked'),
      resend: jest.fn().mockResolvedValue('resent'),
      complete: jest.fn().mockResolvedValue('completed'),
    };
    const controller = new PreOnboardingController(service as any);

    const dto = { employeeId: 'emp-1' } as any;
    await controller.create(mockHrAdmin, dto);
    expect(service.create).toHaveBeenCalledWith(mockHrAdmin, dto);

    await controller.list(mockHrAdmin, 'INVITED');
    expect(service.list).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'INVITED');

    await controller.get(mockHrAdmin, 'invite-1');
    expect(service.get).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'invite-1');

    await controller.revoke(mockHrAdmin, 'invite-1');
    expect(service.revoke).toHaveBeenCalledWith(mockHrAdmin, 'invite-1');

    await controller.resend(mockHrAdmin, 'invite-1');
    expect(service.resend).toHaveBeenCalledWith(mockHrAdmin, 'invite-1');

    await controller.complete(mockHrAdmin, 'invite-1');
    expect(service.complete).toHaveBeenCalledWith(mockHrAdmin, 'invite-1');
  });

  it('PublicPreOnboardingController', async () => {
    const service = {
      getPublic: jest.fn().mockResolvedValue('view'),
      saveDetailsPublic: jest.fn().mockResolvedValue('view'),
      uploadDocumentPublic: jest.fn().mockResolvedValue('view'),
      submitPublic: jest.fn().mockResolvedValue('view'),
    };
    const controller = new PublicPreOnboardingController(service as any);

    await controller.get('tok');
    expect(service.getPublic).toHaveBeenCalledWith('tok');

    const details = { mobileNumber: '123' } as any;
    await controller.saveDetails('tok', details);
    expect(service.saveDetailsPublic).toHaveBeenCalledWith('tok', details);

    const file = { originalname: 'x.pdf' } as any;
    await controller.uploadDocument('tok', 'photo_id', file);
    expect(service.uploadDocumentPublic).toHaveBeenCalledWith('tok', 'photo_id', file);

    await controller.submit('tok');
    expect(service.submitPublic).toHaveBeenCalledWith('tok');
  });

  it('RecruitmentReportsController', async () => {
    const service = { funnel: jest.fn().mockResolvedValue('report') };
    const controller = new RecruitmentReportsController(service as any);

    const query = { jobOpeningId: 'opening-1' } as any;
    await controller.funnel(mockHrAdmin, query);
    expect(service.funnel).toHaveBeenCalledWith(mockHrAdmin, query);
  });
});
