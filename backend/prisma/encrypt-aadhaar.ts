/**
 * One-off migration: encrypt Aadhaar numbers that were stored as plaintext
 * before field-level encryption was introduced.
 *
 * Idempotent: rows already carrying the `enc:v1:` prefix are skipped.
 *
 * Usage (FIELD_ENCRYPTION_KEY and DATABASE_URL must be set):
 *   npm run prisma:encrypt-aadhaar
 */
import { PrismaClient } from '@prisma/client';
import { FieldEncryptionService } from '../src/common/crypto/field-encryption.service';

const prisma = new PrismaClient();

async function main() {
  const key = process.env.FIELD_ENCRYPTION_KEY;
  if (!key) {
    console.error('FIELD_ENCRYPTION_KEY is not set; aborting.');
    process.exit(1);
  }
  const crypto = new FieldEncryptionService({ get: () => key } as any);

  const rows = await prisma.employee.findMany({
    where: { aadhaarNumber: { not: null } },
    select: { id: true, aadhaarNumber: true },
  });

  let encrypted = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.aadhaarNumber || crypto.isEncrypted(row.aadhaarNumber)) {
      skipped++;
      continue;
    }
    await prisma.employee.update({
      where: { id: row.id },
      data: { aadhaarNumber: crypto.encrypt(row.aadhaarNumber) },
    });
    encrypted++;
  }

  console.log(`Aadhaar encryption complete: ${encrypted} encrypted, ${skipped} already encrypted or empty.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
