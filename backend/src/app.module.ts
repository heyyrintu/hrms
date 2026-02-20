import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { WinstonModule } from 'nest-winston';
import { validate } from './config/env.validation';
import { loggerConfig } from './config/logger.config';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { EmailModule } from './common/email/email.module';
import { QueueModule } from './common/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DesignationsModule } from './modules/designations/designations.module';
import { BranchesModule } from './modules/branches/branches.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { LeaveModule } from './modules/leave/leave.module';
import { AdminModule } from './modules/admin/admin.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { HolidaysModule } from './modules/holidays/holidays.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SelfServiceModule } from './modules/self-service/self-service.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { AuditModule } from './modules/audit/audit.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { LettersModule } from './modules/letters/letters.module';
import { ExitModule } from './modules/exit/exit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
    }),
    WinstonModule.forRoot(loggerConfig(process.env.LOG_LEVEL)),
    CacheModule.register({
      isGlobal: true,
      ttl: 300,
    }),
    PrismaModule,
    StorageModule,
    EmailModule,
    QueueModule.register(),
    AuthModule,
    EmployeesModule,
    DepartmentsModule,
    DesignationsModule,
    BranchesModule,
    AttendanceModule,
    LeaveModule,
    AdminModule,
    CompaniesModule,
    UploadsModule,
    HolidaysModule,
    ShiftsModule,
    DocumentsModule,
    SelfServiceModule,
    NotificationsModule,
    AnnouncementsModule,
    ReportsModule,
    PayrollModule,
    ExpensesModule,
    OnboardingModule,
    AuditModule,
    PerformanceModule,
    LettersModule,
    ExitModule,
  ],
})
export class AppModule {}
