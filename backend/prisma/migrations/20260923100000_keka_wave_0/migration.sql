-- Wave 0: night shifts. A shift whose end time falls on the next calendar day.
ALTER TABLE "shifts" ADD COLUMN "isOvernight" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: times are zero-padded "HH:mm", so a string compare orders them.
-- Equal times are a 24-hour shift and count as overnight.
UPDATE "shifts" SET "isOvernight" = true WHERE "endTime" <= "startTime";
