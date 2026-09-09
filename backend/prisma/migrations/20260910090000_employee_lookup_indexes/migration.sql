-- Foreign keys that are filtered on but had no index, plus the pair resolved on
-- every biometric punch. All three are plain index additions: no data changes.
CREATE INDEX "employees_designationId_idx" ON "employees"("designationId");
CREATE INDEX "employees_branchId_idx" ON "employees"("branchId");
CREATE INDEX "employees_tenantId_biometricUserId_idx" ON "employees"("tenantId", "biometricUserId");
