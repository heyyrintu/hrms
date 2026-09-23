import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('EmailService attachments (SMTP)', () => {
  let sendMail: jest.Mock;
  let service: EmailService;

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const env: Record<string, unknown> = { SMTP_HOST: 'smtp.test', SMTP_FROM: 'HRMS <hr@acme.test>' };
    const config = {
      get: jest.fn((key: string, def?: unknown) => env[key] ?? def),
    } as unknown as ConfigService;
    service = new EmailService(config);
  });

  it('passes base64 attachments through to nodemailer', async () => {
    const content = Buffer.from('%PDF-1.4').toString('base64');

    await service.sendEmail({
      to: 'asha@acme.test',
      subject: 'Payslip',
      html: '<p>hi</p>',
      attachments: [
        { filename: 'payslip.pdf', contentType: 'application/pdf', contentBase64: content },
      ],
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'asha@acme.test',
        attachments: [
          {
            filename: 'payslip.pdf',
            contentType: 'application/pdf',
            content,
            encoding: 'base64',
          },
        ],
      }),
    );
  });

  it('sends no attachments key when none are given', async () => {
    await service.sendEmail({ to: 'a@acme.test', subject: 'Hi', html: '<p>hi</p>' });

    expect(sendMail.mock.calls[0][0].attachments).toBeUndefined();
  });

  it('renders the payslip-published template', async () => {
    await service.sendEmail({
      to: 'a@acme.test',
      subject: 'Payslip',
      template: 'payslip-published',
      context: {
        employeeName: 'Asha Rao',
        periodLabel: 'September 2026',
        companyName: 'Acme Corp',
        payslipUrl: 'https://hr.acme.test/my-payslips',
        hasAttachment: true,
      },
    });

    const html: string = sendMail.mock.calls[0][0].html;
    expect(html).toContain('Asha Rao');
    expect(html).toContain('September 2026');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('https://hr.acme.test/my-payslips');
    expect(html).toContain('attached');
    expect(html).not.toContain('not found');
  });
});
