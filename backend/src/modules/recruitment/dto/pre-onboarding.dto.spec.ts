import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PreOnboardingDetailsDto } from './pre-onboarding.dto';

async function errorsFor(dateOfBirth: unknown): Promise<string[]> {
  const dto = plainToInstance(PreOnboardingDetailsDto, { dateOfBirth });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'dateOfBirth').map((e) => e.property);
}

describe('PreOnboardingDetailsDto.dateOfBirth', () => {
  it('accepts a plain calendar date, null, or nothing', async () => {
    expect(await errorsFor('1995-06-15')).toEqual([]);
    expect(await errorsFor('2000-02-29')).toEqual([]);
    expect(await errorsFor(null)).toEqual([]);
    expect(await errorsFor(undefined)).toEqual([]);
  });

  // The service appends T00:00:00.000Z; a full datetime would become an
  // Invalid Date and a 500 from Prisma instead of a 400.
  it.each([
    '1995-06-15T10:00:00Z',
    '1995-06-15T00:00:00.000Z',
    '1995-6-15',
    '1995-13-01',
    '1995-02-30',
    '1999-02-29',
    '15/06/1995',
  ])('rejects %s', async (value) => {
    expect(await errorsFor(value)).toEqual(['dateOfBirth']);
  });
});
