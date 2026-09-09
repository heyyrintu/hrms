-- Forced password change for accounts created with a shared initial password.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Session revocation. Tokens carry the version they were issued with; bumping
-- this invalidates every token already in circulation for that user.
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Date of birth is a calendar date, not an instant. Storing it as a timestamp
-- shifted it by a day either side of UTC depending on the reader's timezone.
ALTER TABLE "employees" ALTER COLUMN "dateOfBirth" TYPE DATE USING "dateOfBirth"::date;
