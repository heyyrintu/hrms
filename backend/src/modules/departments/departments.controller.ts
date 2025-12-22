import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

@Controller('departments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepartmentsController {
  constructor(private departmentsService: DepartmentsService) {}

  /**
   * Create a new department
   * POST /api/departments
   */
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.departmentsService.create(user.tenantId, dto);
  }

  /**
   * Get all departments
   * GET /api/departments
   */
  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.departmentsService.findAll(user.tenantId);
  }

  /**
   * Get department hierarchy
   * GET /api/departments/hierarchy
   */
  @Get('hierarchy')
  async getHierarchy(@CurrentUser() user: AuthenticatedUser) {
    return this.departmentsService.getHierarchy(user.tenantId);
  }

  /**
   * Get department by ID
   * GET /api/departments/:id
   */
  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.departmentsService.findOne(user.tenantId, id);
  }

  /**
   * Update department
   * PUT /api/departments/:id
   */
  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departmentsService.update(user.tenantId, id, dto);
  }

  /**
   * Delete department
   * DELETE /api/departments/:id
   */
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.departmentsService.remove(user.tenantId, id);
  }
}
