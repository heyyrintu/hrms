import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { UpdateStatutoryConfigDto } from './statutory.dto';

/**
 * The DTO is the whole story for what a tenant can configure.
 *
 * The application pipe runs with `forbidNonWhitelisted`, so a field the DTO
 * does not declare is not quietly dropped: the request is rejected. A setting
 * absent here is a setting nobody can change through the API.
 */
describe('UpdateStatutoryConfigDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const parse = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateStatutoryConfigDto });

  it('accepts the provident fund settings', async () => {
    await expect(parse({ pfEnabled: true, pfEmployeeRate: 12 })).resolves.toMatchObject({
      pfEnabled: true,
      pfEmployeeRate: 12,
    });
  });

  it('accepts the gratuity parameters, which are configuration and not constants', async () => {
    // The Act says fifteen days on a twenty-six day month after five years, but
    // an employer may pay better than the Act, and the exemption ceiling has
    // been revised more than once. Holding these as rows is pointless if the
    // only way to change them is a database client.
    await expect(
      parse({
        gratuityEnabled: true,
        gratuityDaysPerYear: 15,
        gratuityMonthDays: 26,
        gratuityMinYears: 5,
        gratuityExemptionCap: 2000000,
      }),
    ).resolves.toMatchObject({
      gratuityEnabled: true,
      gratuityDaysPerYear: 15,
      gratuityMonthDays: 26,
      gratuityMinYears: 5,
      gratuityExemptionCap: 2000000,
    });
  });

  it('accepts the leave encashment settings', async () => {
    await expect(
      parse({ leaveEncashmentEnabled: true, encashmentMonthDays: 30 }),
    ).resolves.toMatchObject({
      leaveEncashmentEnabled: true,
      encashmentMonthDays: 30,
    });
  });

  it('refuses a negative gratuity ceiling', async () => {
    await expect(parse({ gratuityExemptionCap: -1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a qualifying period that is not a number of years', async () => {
    await expect(parse({ gratuityMinYears: 'five' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('still refuses a field the schema does not have', async () => {
    await expect(parse({ pfEmployeeRateTypo: 12 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts the investment proof settings', async () => {
    await expect(
      parse({ proofVerificationRequired: true, proofCutoffMonth: 1 }),
    ).resolves.toMatchObject({ proofVerificationRequired: true, proofCutoffMonth: 1 });
  });

  it('refuses a cutoff that is not a month of the year', async () => {
    await expect(parse({ proofCutoffMonth: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(parse({ proofCutoffMonth: 13 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts the months a state actually collects professional tax in', async () => {
    // Empty means every month, which is what most states do. Tamil Nadu and
    // others collect half-yearly, and their slab amounts are period amounts.
    await expect(parse({ ptMonths: [3, 9] })).resolves.toMatchObject({
      ptMonths: [3, 9],
    });
  });

  it('refuses a professional tax month that is not a month', async () => {
    await expect(parse({ ptMonths: [0] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ ptMonths: [13] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the section 10(10AA) parameters', async () => {
    await expect(
      parse({
        encashmentExemptionCap: 2500000,
        encashmentExemptDaysPerYear: 30,
        encashmentExemptMonths: 10,
        encashmentGovernmentEmployer: false,
      }),
    ).resolves.toMatchObject({ encashmentExemptionCap: 2500000 });
  });
});
