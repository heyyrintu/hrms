import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Prisma Decimal / string / number -> finite number, else null. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The user account linked to an employee, used as the requester for the
 * self-approval rule. Null when the employee has no login.
 */
export async function findUserIdForEmployee(
  db: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  employeeId: string,
): Promise<string | null> {
  const user = await db.user.findFirst({
    where: { tenantId, employeeId },
    select: { id: true },
  });
  return user?.id ?? null;
}
