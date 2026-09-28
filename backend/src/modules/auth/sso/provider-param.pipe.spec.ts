import { BadRequestException } from '@nestjs/common';
import { SsoProvider } from '@prisma/client';
import { SsoProviderParamPipe } from './provider-param.pipe';

describe('SsoProviderParamPipe', () => {
  const pipe = new SsoProviderParamPipe();

  it('maps "google" to SsoProvider.GOOGLE', () => {
    expect(pipe.transform('google')).toBe(SsoProvider.GOOGLE);
  });

  it('maps "microsoft" to SsoProvider.MICROSOFT', () => {
    expect(pipe.transform('microsoft')).toBe(SsoProvider.MICROSOFT);
  });

  it('is case-insensitive', () => {
    expect(pipe.transform('GOOGLE')).toBe(SsoProvider.GOOGLE);
    expect(pipe.transform('Microsoft')).toBe(SsoProvider.MICROSOFT);
  });

  it('400s on an unknown provider', () => {
    expect(() => pipe.transform('okta')).toThrow(BadRequestException);
  });

  it('400s on an empty value', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });
});
