import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpsertWorkflowDto } from './upsert-workflow.dto';

// Same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: UpsertWorkflowDto });

const body = (step2: Record<string, unknown>) => ({
  steps: [
    { name: 'Manager', approverType: 'REPORTING_MANAGER' },
    { name: 'Finance', approverType: 'HR_ADMIN', ...step2 },
  ],
});

describe('UpsertWorkflowDto step conditions', () => {
  it('accepts the largest values the DECIMAL(14,2) / DECIMAL(6,2) columns hold', async () => {
    await expect(
      validate(body({ minAmount: 999999999999.99, minDays: 9999.99 })),
    ).resolves.toBeInstanceOf(UpsertWorkflowDto);
  });

  it('rejects a minAmount beyond DECIMAL(14,2) with 400', async () => {
    await expect(validate(body({ minAmount: 1_000_000_000_000 }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a minDays beyond DECIMAL(6,2) with 400', async () => {
    await expect(validate(body({ minDays: 10000 }))).rejects.toThrow(BadRequestException);
  });
});
