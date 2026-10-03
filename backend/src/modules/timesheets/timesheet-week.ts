import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of a UTC-midnight date. */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Parse a `YYYY-MM-DD` wire date to UTC midnight; 400 on anything else. */
export function parseDateOnly(value: string, label = 'date'): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} must be a YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || isoDate(parsed) !== value) {
    throw new BadRequestException(`${label} must be a valid date`);
  }
  return parsed;
}

/** The Sunday that closes the week starting on `weekStart`. */
export function weekEnd(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 6 * DAY_MS);
}

/** `weekStart` must be a Monday (UTC calendar day). */
export function assertMonday(d: Date): void {
  if (d.getUTCDay() !== 1) {
    throw new BadRequestException('weekStart must be a Monday');
  }
}

/** Prisma Decimal or number to a plain number (2 dp is exact in a double). */
export function toHours(dec: Prisma.Decimal | number): number {
  return typeof dec === 'number' ? dec : dec.toNumber();
}
