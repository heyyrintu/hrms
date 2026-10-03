import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertMonday, isoDate, parseDateOnly, toHours, weekEnd } from './timesheet-week';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('timesheet-week', () => {
  it('weekEnd is the Sunday after a Monday', () => {
    expect(isoDate(weekEnd(d('2026-03-16')))).toBe('2026-03-22');
  });

  it('assertMonday accepts a Monday and refuses any other day', () => {
    expect(() => assertMonday(d('2026-03-16'))).not.toThrow();
    expect(() => assertMonday(d('2026-03-17'))).toThrow(BadRequestException);
    expect(() => assertMonday(d('2026-03-22'))).toThrow(BadRequestException);
  });

  it('toHours reads Decimals and numbers', () => {
    expect(toHours(new Prisma.Decimal('7.25'))).toBe(7.25);
    expect(toHours(3)).toBe(3);
  });

  it('parseDateOnly is strict', () => {
    expect(isoDate(parseDateOnly('2026-03-16'))).toBe('2026-03-16');
    expect(() => parseDateOnly('2026-3-16')).toThrow(BadRequestException);
    expect(() => parseDateOnly('2026-02-30')).toThrow(BadRequestException);
    expect(() => parseDateOnly('2026-03-16T10:00:00Z')).toThrow(BadRequestException);
  });
});
