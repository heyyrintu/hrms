-- Devices re-send punches whenever our "OK: n" acknowledgement is lost, so the
-- same (device, user, time, type) tuple must be stored at most once.

-- 1. Remove duplicates that already exist, keeping the earliest row.
DELETE FROM "device_attendance_logs" d
USING "device_attendance_logs" keep
WHERE d."deviceId" = keep."deviceId"
  AND d."deviceUserId" = keep."deviceUserId"
  AND d."punchTime" = keep."punchTime"
  AND d."punchType" = keep."punchType"
  AND d."createdAt" > keep."createdAt";

-- 2. Enforce uniqueness going forward.
CREATE UNIQUE INDEX "device_attendance_logs_deviceId_deviceUserId_punchTime_punchType_key"
  ON "device_attendance_logs"("deviceId", "deviceUserId", "punchTime", "punchType");
