-- Wave 0: night shifts. A shift whose end time falls on the next calendar day.
ALTER TABLE "shifts" ADD COLUMN "isOvernight" BOOLEAN NOT NULL DEFAULT false;
