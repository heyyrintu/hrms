-- Carry the tenant explicitly on these child tables. Access is safe today only
-- because every path joins the tenant-scoped parent; a direct query would leak
-- across tenants. Backfilled from the parent, then made mandatory.

-- attendance_sessions
ALTER TABLE "attendance_sessions" ADD COLUMN "tenantId" TEXT;
UPDATE "attendance_sessions" s
SET "tenantId" = a."tenantId"
FROM "attendance_records" a
WHERE a."id" = s."attendanceId";
DELETE FROM "attendance_sessions" WHERE "tenantId" IS NULL; -- orphans, if any
ALTER TABLE "attendance_sessions" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "attendance_sessions_tenantId_idx" ON "attendance_sessions"("tenantId");
ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- device_attendance_logs
ALTER TABLE "device_attendance_logs" ADD COLUMN "tenantId" TEXT;
UPDATE "device_attendance_logs" l
SET "tenantId" = d."tenantId"
FROM "biometric_devices" d
WHERE d."id" = l."deviceId";
DELETE FROM "device_attendance_logs" WHERE "tenantId" IS NULL; -- orphans, if any
ALTER TABLE "device_attendance_logs" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "device_attendance_logs_tenantId_idx" ON "device_attendance_logs"("tenantId");
ALTER TABLE "device_attendance_logs"
  ADD CONSTRAINT "device_attendance_logs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
