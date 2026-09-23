import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeImportController } from './import/employee-import.controller';
import { EmployeeImportService } from './import/employee-import.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  // The import controller is registered first so `employees/import/...` is
  // matched before `employees/:id`.
  controllers: [EmployeeImportController, EmployeesController],
  providers: [EmployeesService, EmployeeImportService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
