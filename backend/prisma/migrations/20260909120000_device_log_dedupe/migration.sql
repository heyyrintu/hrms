-- Devices re-send punches whenever our "OK: n" acknowledgement is lost, so the
-- same (device, user, time, type) tuple must be stored at most once.

-- 1. Remove duplicates that already exist, keeping exactly one row per group.
--    The tiebreaker includes "id" because createdAt defaults to CURRENT_TIMESTAMP,
--    which is the transaction start time: rows written in one transaction share it,
--    and a bare "createdAt >" comparison would delete none of them, leaving the
--    unique index below to fail and abort the whole migration.
DELETE FROM "device_attendance_logs" d
USING "device_attendance_logs" keep
WHERE d."deviceId" = keep."deviceId"
  AND d."deviceUserId" = keep."deviceUserId"
  AND d."punchTime" = keep."punchTime"
  AND d."punchType" = keep."punchType"
  AND (d."createdAt", d."id") > (keep."createdAt", keep."id");

-- 2. Enforce uniqueness going forward.
--    The name is pinned explicitly: the Prisma-derived name would exceed the
--    63-byte PostgreSQL identifier limit and be silently truncated, so the
--    database and the schema could disagree and produce migration drift.
CREATE UNIQUE INDEX "device_attendance_logs_punch_key"
  ON "device_attendance_logs"("deviceId", "deviceUserId", "punchTime", "punchType");
