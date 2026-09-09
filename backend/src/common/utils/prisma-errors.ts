import { Prisma } from '@prisma/client';

/** Prisma error codes we branch on. */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_RECORD_NOT_FOUND = 'P2025';
/** Serializable transaction lost a write race; the caller may retry. */
export const PRISMA_WRITE_CONFLICT = 'P2034';

/**
 * True when `err` is a known Prisma request error with the given code.
 * P2025 is raised by `update`/`delete` when the `where` clause matches no row,
 * which is how status-guarded updates detect a concurrent state change.
 */
export function isPrismaError(err: unknown, code: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
  );
}
