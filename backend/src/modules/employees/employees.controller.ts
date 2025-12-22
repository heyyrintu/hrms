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
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto, EmployeeQueryDto } from './dto/employee.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  /**
   * Create a new employee
   * POST /api/employees
   */
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.employeesService.create(user.tenantId, dto);
  }

  /**
   * Get all employees with pagination and filters
   * GET /api/employees
   */
  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeeQueryDto,
  ) {
    return this.employeesService.findAll(user.tenantId, query);
  }

  /**
   * Get employee by ID
   * GET /api/employees/:id
   */
  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.employeesService.findOne(user.tenantId, id);
  }

  /**
   * Get Employee 360 view
   * GET /api/employees/:id/360
   */
  @Get(':id/360')
  async get360View(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.employeesService.get360View(user.tenantId, id);
  }

  /**
   * Get direct reports for a manager
   * GET /api/employees/:id/direct-reports
   */
  @Get(':id/direct-reports')
  async getDirectReports(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.employeesService.getDirectReports(user.tenantId, id);
  }

  /**
   * Update employee
   * PUT /api/employees/:id
   */
  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(user.tenantId, id, dto);
  }

  /**
   * Delete employee (soft delete)
   * DELETE /api/employees/:id
   */
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.employeesService.remove(user.tenantId, id);
  }
}
