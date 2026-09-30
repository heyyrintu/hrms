import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBadgeDto } from './recognition.dto';

describe('UpdateBadgeDto', () => {
  const errorsFor = (body: Record<string, unknown>) =>
    validate(plainToInstance(UpdateBadgeDto, body));

  it('accepts isActive as a boolean so a badge can be reactivated', async () => {
    expect(await errorsFor({ isActive: true })).toHaveLength(0);
    expect(await errorsFor({ isActive: false })).toHaveLength(0);
  });

  it('rejects a non-boolean isActive', async () => {
    const errors = await errorsFor({ isActive: 'yes' });
    expect(errors.map((e) => e.property)).toEqual(['isActive']);
  });

  it('keeps isActive optional', async () => {
    expect(await errorsFor({ name: 'Star' })).toHaveLength(0);
  });
});
