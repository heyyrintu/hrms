import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { LettersService } from './letters.service';
import {
  CreateLetterTemplateDto,
  UpdateLetterTemplateDto,
  GenerateLetterDto,
  LetterQueryDto,
} from './dto/letter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('letters')
@ApiBearerAuth()
@Controller('letters')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LettersController {
  constructor(private lettersService: LettersService) {}

  // ── Template CRUD (HR/Admin only) ──────────────────────────

  @Post('templates')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Create letter template' })
  @ApiResponse({ status: 201, description: 'Template created' })
  async createTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLetterTemplateDto,
  ) {
    return this.lettersService.createTemplate(user.tenantId, dto);
  }

  @Get('templates')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'List letter templates' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LetterQueryDto,
  ) {
    return this.lettersService.getTemplates(user.tenantId, query);
  }

  @Get('templates/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Get letter template by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.lettersService.getTemplate(user.tenantId, id);
  }

  @Put('templates/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Update letter template' })
  @ApiResponse({ status: 200, description: 'Updated' })
  async updateTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLetterTemplateDto,
  ) {
    return this.lettersService.updateTemplate(user.tenantId, id, dto);
  }

  @Delete('templates/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Delete letter template' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  async deleteTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.lettersService.deleteTemplate(user.tenantId, id);
  }

  // ── Letter Generation ──────────────────────────────────────

  @Post('generate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Generate letter for employee from template' })
  @ApiResponse({ status: 201, description: 'Letter generated' })
  async generateLetter(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateLetterDto,
  ) {
    return this.lettersService.generateLetter(user.tenantId, user.userId, dto);
  }

  @Get('generated')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'List all generated letters' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getGeneratedLetters(@CurrentUser() user: AuthenticatedUser) {
    return this.lettersService.getGeneratedLetters(user.tenantId);
  }

  @Get('generated/me')
  @ApiOperation({ summary: 'Get my generated letters (employee)' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getMyLetters(@CurrentUser() user: AuthenticatedUser) {
    return this.lettersService.getMyLetters(user.tenantId, user.employeeId ?? '');
  }

  @Get('generated/:id')
  @ApiOperation({ summary: 'Get generated letter by ID' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getGeneratedLetter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.lettersService.getGeneratedLetter(user.tenantId, id);
  }

  @Get('generated/:id/pdf')
  @ApiOperation({ summary: 'Download generated letter as PDF' })
  @ApiResponse({ status: 200, description: 'PDF file' })
  async downloadPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.lettersService.generatePdf(user.tenantId, id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="letter-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
