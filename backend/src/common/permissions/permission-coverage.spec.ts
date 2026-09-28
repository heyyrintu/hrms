import 'reflect-metadata';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from './require-permissions.decorator';

import { DepartmentsController } from '../../modules/departments/departments.controller';
import { DesignationsController } from '../../modules/designations/designations.controller';
import { BranchesController } from '../../modules/branches/branches.controller';
import { HolidaysController } from '../../modules/holidays/holidays.controller';
import { ShiftsController } from '../../modules/shifts/shifts.controller';
import { DocumentExpiryController } from '../../modules/documents/document-expiry.controller';
import { AttendancePolicyController } from '../../modules/attendance/policy/attendance-policy.controller';
import { BiometricAdminController } from '../../modules/biometric/biometric-admin.controller';
import { LeaveAccrualController } from '../../modules/leave/leave-accrual.controller';
import { LeaveCarryForwardController } from '../../modules/leave/leave-carry-forward.controller';
import { StatutoryController } from '../../modules/payroll/statutory/statutory.controller';
import { SlabsController } from '../../modules/payroll/slabs/slabs.controller';
import { ProofsController } from '../../modules/payroll/proofs/proofs.controller';
import { ReturnsController } from '../../modules/payroll/returns/returns.controller';
import { PayrollReportsController } from '../../modules/payroll/accounting/payroll-reports.controller';
import { PayrollAccountingController } from '../../modules/payroll/accounting/payroll-accounting.controller';
import { PayrollAdjustmentsController } from '../../modules/payroll/adjustments/payroll-adjustments.controller';
import { ExitController } from '../../modules/exit/exit.controller';
import { SettlementController } from '../../modules/exit/settlement/settlement.controller';
import { RecruitmentSettingsController } from '../../modules/recruitment/recruitment-settings.controller';
import { PipelineStagesController } from '../../modules/recruitment/pipeline-stages.controller';
import { CandidatesController } from '../../modules/recruitment/candidates.controller';
import { EmployeeImportController } from '../../modules/employees/import/employee-import.controller';
import { AuditController } from '../../modules/audit/audit.controller';
import { WebhooksController } from '../../modules/webhooks/webhooks.controller';
import { WorkflowsController } from '../../modules/workflow/workflows.controller';

/**
 * Spec §1.4: the 26 controllers moved to permissions in H1. Every place that
 * carries @Roles metadata (class or method) must carry
 * @RequirePermissions(key) equal to [key] at the same level, and nothing
 * without @Roles may carry @RequirePermissions. Written first (RED before
 * the controllers are decorated).
 */
const TABLE: Array<[new (...args: any[]) => unknown, string]> = [
  [DepartmentsController, 'org.manage'],
  [DesignationsController, 'org.manage'],
  [BranchesController, 'org.manage'],
  [HolidaysController, 'org.manage'],
  [ShiftsController, 'org.manage'],
  [DocumentExpiryController, 'org.manage'],
  [AttendancePolicyController, 'attendance.config.manage'],
  [BiometricAdminController, 'attendance.config.manage'],
  [LeaveAccrualController, 'leave.config.manage'],
  [LeaveCarryForwardController, 'leave.config.manage'],
  [StatutoryController, 'payroll.statutory.manage'],
  [SlabsController, 'payroll.statutory.manage'],
  [ProofsController, 'payroll.proofs.review'],
  [ReturnsController, 'payroll.reports.view'],
  [PayrollReportsController, 'payroll.reports.view'],
  [PayrollAccountingController, 'payroll.accounting.manage'],
  [PayrollAdjustmentsController, 'payroll.adjustments.manage'],
  [ExitController, 'exit.manage'],
  [SettlementController, 'exit.manage'],
  [RecruitmentSettingsController, 'recruitment.config.manage'],
  [PipelineStagesController, 'recruitment.config.manage'],
  [CandidatesController, 'recruitment.config.manage'],
  [EmployeeImportController, 'employees.import'],
  [AuditController, 'audit.view'],
  [WebhooksController, 'integrations.manage'],
  [WorkflowsController, 'integrations.manage'],
];

function assertCoverage(target: object, expectedKey: string, label: string) {
  const roles = Reflect.getMetadata(ROLES_KEY, target);
  const permissions = Reflect.getMetadata(PERMISSIONS_KEY, target);

  if (roles !== undefined) {
    expect({ label, permissions }).toEqual({ label, permissions: [expectedKey] });
  } else {
    expect({ label, permissions }).toEqual({ label, permissions: undefined });
  }
}

describe('permission coverage (Keka wave H1, spec §1.4)', () => {
  for (const [ControllerClass, key] of TABLE) {
    describe(`${ControllerClass.name} -> ${key}`, () => {
      it('decorates the class and every @Roles method with @RequirePermissions([key])', () => {
        assertCoverage(ControllerClass, key, ControllerClass.name);

        const proto = (ControllerClass as any).prototype;
        for (const methodName of Object.getOwnPropertyNames(proto)) {
          if (methodName === 'constructor') continue;
          const handler = proto[methodName];
          if (typeof handler !== 'function') continue;
          assertCoverage(handler, key, `${ControllerClass.name}.${methodName}`);
        }
      });
    });
  }
});
