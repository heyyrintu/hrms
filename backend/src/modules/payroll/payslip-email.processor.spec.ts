import { PayslipEmailProcessor } from './payslip-email.processor';
import { PAYSLIP_EMAIL_JOB } from './payslip-email.service';

describe('PayslipEmailProcessor', () => {
  let payslipEmailService: { sendPayslipEmail: jest.Mock };
  let processor: PayslipEmailProcessor;

  beforeEach(() => {
    payslipEmailService = { sendPayslipEmail: jest.fn().mockResolvedValue('sent') };
    processor = new PayslipEmailProcessor(payslipEmailService as any);
  });

  it('sends the one payslip named in the job, within its tenant', async () => {
    await processor.process({
      id: 'job-1',
      name: PAYSLIP_EMAIL_JOB,
      data: { tenantId: 'tenant-1', payslipId: 'ps-1' },
    } as any);

    expect(payslipEmailService.sendPayslipEmail).toHaveBeenCalledWith('tenant-1', 'ps-1');
  });

  it('rethrows so BullMQ can retry a failed send', async () => {
    payslipEmailService.sendPayslipEmail.mockRejectedValue(new Error('db blip'));

    await expect(
      processor.process({
        id: 'job-1',
        name: PAYSLIP_EMAIL_JOB,
        data: { tenantId: 'tenant-1', payslipId: 'ps-1' },
      } as any),
    ).rejects.toThrow('db blip');
  });

  it('fails loudly on a job name it does not handle', async () => {
    await expect(
      processor.process({ id: 'job-2', name: 'something-else', data: {} } as any),
    ).rejects.toThrow(/something-else/);
    expect(payslipEmailService.sendPayslipEmail).not.toHaveBeenCalled();
  });
});
