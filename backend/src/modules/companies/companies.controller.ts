import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto, CompanyQueryDto } from './dto/company.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN) // Only super admins can manage companies
export class CompaniesController {
  constructor(private companiesService: CompaniesService) {}

  /**
   * Create a new company with initial admin
   * POST /api/companies
   */
  @Post()
  async create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  /**
   * Get all companies
   * GET /api/companies
   */
  @Get()
  async findAll(@Query() query: CompanyQueryDto) {
    return this.companiesService.findAll(query);
  }

  /**
   * Get company statistics summary
   * GET /api/companies/stats
   */
  @Get('stats')
  async getStats() {
    return this.companiesService.getStatsSummary();
  }

  /**
   * Get company by ID
   * GET /api/companies/:id
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.companiesService.findOne(id);
  }

  /**
   * Update company
   * PUT /api/companies/:id
   */
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.update(id, dto);
  }

  /**
   * Toggle company active status
   * PUT /api/companies/:id/toggle-status
   */
  @Put(':id/toggle-status')
  async toggleStatus(@Param('id') id: string) {
    return this.companiesService.toggleStatus(id);
  }

  /**
   * Delete company
   * DELETE /api/companies/:id
   */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.companiesService.remove(id);
  }
}
