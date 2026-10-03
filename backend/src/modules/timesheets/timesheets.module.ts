import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RosterModule } from '../roster/roster.module';
import { TimesheetsController } from './timesheets.controller';
import { TimesheetsService } from './timesheets.service';
import { TimesheetWorkflowHandler } from './timesheet-workflow.handler';
import { UtilisationController } from './utilisation.controller';
import { UtilisationService } from './utilisation.service';

/** Keka wave G: weekly timesheets and the utilisation report. PrismaModule is global. */
@Module({
  imports: [WorkflowModule, NotificationsModule, RosterModule],
  controllers: [TimesheetsController, UtilisationController],
  providers: [TimesheetsService, TimesheetWorkflowHandler, UtilisationService],
})
export class TimesheetsModule {}
