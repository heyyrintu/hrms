import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { InterviewsService } from './interviews.service';
import { ScheduleInterviewDto, SubmitFeedbackDto, UpdateInterviewDto } from './dto/interview.dto';
import {
  InterviewFeedbackListView,
  InterviewFeedbackView,
  InterviewView,
} from './recruitment.types';

/**
 * Interviews and feedback. The class is open to every role; route-level
 * @Roles narrow it, and the service applies the hiring-manager / panelist
 * rules (Keka wave D2).
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('recruitment')
export class InterviewsController {
  constructor(private readonly service: InterviewsService) {}

  @Get('applications/:id/interviews')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "An application's interviews" })
  @ApiResponse({ status: 403, description: 'Not HR or the hiring manager' })
  list(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<InterviewView[]> {
    return this.service.listForApplication(user, id);
  }

  @Post('applications/:id/interviews')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Schedule an interview with a panel' })
  @ApiResponse({ status: 400, description: 'Application not active, bad times or panel' })
  schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ScheduleInterviewDto,
  ): Promise<InterviewView> {
    return this.service.schedule(user, id, dto);
  }

  /** Declared before `interviews/:id…` so "mine" is not taken for an id. */
  @Get('interviews/mine')
  @ApiOperation({ summary: 'Interviews I am on the panel of' })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<InterviewView[]> {
    return this.service.mine(user);
  }

  @Patch('interviews/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Reschedule / edit an interview' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateInterviewDto,
  ): Promise<InterviewView> {
    return this.service.update(user, id, dto);
  }

  @Post('interviews/:id/cancel')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Cancel an interview' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<InterviewView> {
    return this.service.setStatus(user, id, 'CANCELLED');
  }

  @Post('interviews/:id/complete')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Mark an interview completed' })
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<InterviewView> {
    return this.service.setStatus(user, id, 'COMPLETED');
  }

  @Post('interviews/:id/no-show')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Mark the candidate a no-show' })
  noShow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<InterviewView> {
    return this.service.setStatus(user, id, 'NO_SHOW');
  }

  @Get('interviews/:id/feedback')
  @ApiOperation({ summary: 'Feedback on an interview (HR, hiring manager, panel after submitting)' })
  @ApiResponse({ status: 403, description: 'Not allowed to see this feedback' })
  feedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<InterviewFeedbackListView> {
    return this.service.listFeedback(user, id);
  }

  @Post('interviews/:id/feedback')
  @ApiOperation({ summary: 'Submit or update my scorecard (panelists only)' })
  @ApiResponse({ status: 403, description: 'Not on the panel' })
  submitFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitFeedbackDto,
  ): Promise<InterviewFeedbackView> {
    return this.service.submitFeedback(user, id, dto);
  }
}
