import { EmailService } from '../../common/email/email.service';

export function createMockEmailService(): jest.Mocked<EmailService> {
  return {
    sendEmail: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<EmailService>;
}
