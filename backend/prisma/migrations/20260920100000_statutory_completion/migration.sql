-- The two lifetime limits nothing recorded: the section 10(10AA) exemption a
-- leaver used at an earlier employer, and the leave travel journeys already
-- taken in the current block of four calendar years.
--
-- Both additive and both defaulting to zero, so an installation that declares
-- nothing new behaves exactly as it did.

ALTER TABLE "employee_tax_declarations"
  ADD COLUMN "previousEmployerEncashmentExemption" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "ltaJourneysUsedInBlock" INTEGER NOT NULL DEFAULT 0;

-- Section 192(2A): an employer may compute section 89 relief only on
-- particulars furnished in Form 10E. Defaulting to false means relief is
-- refused until the employee furnishes it, which is the safe direction: too
-- much deducted comes back on assessment, too little exposes the employer.
ALTER TABLE "employee_tax_declarations"
  ADD COLUMN "form10EFurnished" BOOLEAN NOT NULL DEFAULT false;
