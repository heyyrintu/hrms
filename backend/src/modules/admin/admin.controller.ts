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
import { AdminService } from './admin.service';
import { CreateOtRuleDto, UpdateOtRuleDto } from './dto/admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  /**
   * Get dashboard statistics
   * GET /api/admin/dashboard
   */
  @Get('dashboard')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getDashboardStats(@CurrentUser() user: AuthenticatedUser) {
    if (user.role === UserRole.MANAGER && user.employeeId) {
      return this.adminService.getManagerDashboardStats(user.tenantId, user.employeeId);
    }
    return this.adminService.getDashboardStats(user.tenantId);
  }

  /**
   * Get all OT rules
   * GET /api/admin/settings/ot-rules
   */
  @Get('settings/ot-rules')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getOtRules(@CurrentUser() user: AuthenticatedUser) {
    return this.adminService.getOtRules(user.tenantId);
  }

  /**
   * Get OT rule by ID
   * GET /api/admin/settings/ot-rules/:id
   */
  @Get('settings/ot-rules/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getOtRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.adminService.getOtRule(user.tenantId, id);
  }

  /**
   * Create OT rule
   * POST /api/admin/settings/ot-rules
   */
  @Post('settings/ot-rules')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async createOtRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOtRuleDto,
  ) {
    return this.adminService.createOtRule(user.tenantId, dto);
  }

  /**
   * Update OT rule
   * PUT /api/admin/settings/ot-rules/:id
   */
  @Put('settings/ot-rules/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async updateOtRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOtRuleDto,
  ) {
    return this.adminService.updateOtRule(user.tenantId, id, dto);
  }

  /**
   * Delete OT rule
   * DELETE /api/admin/settings/ot-rules/:id
   */
  @Delete('settings/ot-rules/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async deleteOtRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.adminService.deleteOtRule(user.tenantId, id);
  }
}
