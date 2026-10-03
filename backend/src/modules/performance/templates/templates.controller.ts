import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { TemplatesService } from './templates.service';
import {
  CreateQuestionDto,
  CreateTemplateDto,
  UpdateQuestionDto,
  UpdateTemplateDto,
} from './dto/templates.dto';

/** Question bank and review templates (spec F2). Admin only. */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  // ---------- Question bank ----------

  @Get('questions')
  @ApiOperation({ summary: 'List the review question bank' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  listQuestions(@CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.listQuestions(user.tenantId);
  }

  @Post('questions')
  @ApiOperation({ summary: 'Add a question to the bank' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  createQuestion(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateQuestionDto) {
    return this.templatesService.createQuestion(user.tenantId, dto);
  }

  @Put('questions/:id')
  @ApiOperation({ summary: 'Update a bank question' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  updateQuestion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.templatesService.updateQuestion(user.tenantId, id, dto);
  }

  @Delete('questions/:id')
  @ApiOperation({ summary: 'Delete a bank question (refused while a template uses it)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Question is used by a template' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  deleteQuestion(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.templatesService.deleteQuestion(user.tenantId, id);
  }

  // ---------- Templates ----------

  @Get('templates')
  @ApiOperation({ summary: 'List review templates' })
  @ApiResponse({ status: 200, description: 'Success' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.templatesService.listTemplates(user.tenantId);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Get a review template' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  getTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.templatesService.getTemplate(user.tenantId, id);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create a review template' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Name already exists' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  createTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTemplateDto) {
    return this.templatesService.createTemplate(user.tenantId, dto);
  }

  @Put('templates/:id')
  @ApiOperation({ summary: 'Update a review template (questions replace the entry list)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  updateTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.updateTemplate(user.tenantId, id, dto);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Delete a review template (refused while a DRAFT cycle uses it)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'A draft cycle uses it' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  deleteTemplate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.templatesService.deleteTemplate(user.tenantId, id);
  }
}
