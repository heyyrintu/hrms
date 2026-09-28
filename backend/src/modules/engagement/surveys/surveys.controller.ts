import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { SurveysService } from './surveys.service';
import { SurveySubmissionService } from './survey-submission.service';
import { SurveyResultsService } from './survey-results.service';
import {
  CreateSurveyDto,
  ListSurveysDto,
  SubmitSurveyDto,
  UpdateSurveyDto,
} from './dto/survey.dto';

const HR_ROLES = [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN] as const;

function requireEmployeeId(user: AuthenticatedUser): string {
  if (!user.employeeId) {
    throw new BadRequestException('No employee record linked to this user');
  }
  return user.employeeId;
}

@ApiTags('engagement-surveys')
@ApiBearerAuth()
@Controller('engagement/surveys')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SurveysController {
  constructor(
    private readonly surveysService: SurveysService,
    private readonly submissionService: SurveySubmissionService,
    private readonly resultsService: SurveyResultsService,
  ) {}

  @Get()
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'List surveys (paginated, optional status filter)' })
  @ApiResponse({ status: 200, description: 'Success' })
  async findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSurveysDto) {
    return this.surveysService.findAll(user.tenantId, query);
  }

  @Post()
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Create a survey with its questions (DRAFT)' })
  @ApiResponse({ status: 201, description: 'Created' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSurveyDto) {
    const employeeId = requireEmployeeId(user);
    return this.surveysService.create(user.tenantId, employeeId, dto);
  }

  /** Declared before `:id` so "mine" is not swallowed as a survey id. */
  @Get('mine')
  @ApiOperation({ summary: 'My surveys' })
  @ApiResponse({ status: 200, description: 'Success' })
  async mine(@CurrentUser() user: AuthenticatedUser) {
    const employeeId = requireEmployeeId(user);
    return this.surveysService.mine(user.tenantId, employeeId);
  }

  @Get(':id')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Get a survey for editing' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.surveysService.findById(user.tenantId, id);
  }

  @Put(':id')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Update a draft survey' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSurveyDto,
  ) {
    return this.surveysService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Delete a draft survey' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.surveysService.delete(user.tenantId, id);
  }

  @Post(':id/launch')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Launch a draft survey' })
  @ApiResponse({ status: 201, description: 'Launched' })
  @ApiResponse({ status: 409, description: 'Not a draft' })
  async launch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.surveysService.launch(user.tenantId, id);
  }

  @Post(':id/close')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Close an active survey' })
  @ApiResponse({ status: 201, description: 'Closed' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.surveysService.close(user.tenantId, id);
  }

  @Get(':id/form')
  @ApiOperation({ summary: 'The survey and questions, for a participant to respond to' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async form(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const employeeId = requireEmployeeId(user);
    return this.surveysService.form(user.tenantId, employeeId, id);
  }

  /**
   * Submitting a response. No `@Audit()` here on purpose: an anonymous
   * survey's response must never be paired with the submitting user in a log.
   */
  @Post(':id/responses')
  @ApiOperation({ summary: 'Submit my response to a survey' })
  @ApiResponse({ status: 201, description: 'Submitted' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Already responded' })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitSurveyDto,
  ) {
    const employeeId = requireEmployeeId(user);
    return this.submissionService.submit(user.tenantId, employeeId, id, dto);
  }

  @Get(':id/results')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Aggregated survey results' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async results(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.resultsService.results(user.tenantId, id);
  }

  @Get(':id/responses')
  @Roles(...HR_ROLES)
  @ApiOperation({ summary: 'Named responses (non-anonymous surveys only)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async namedResponses(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.resultsService.namedResponses(user.tenantId, id);
  }
}
