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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
  CreateExpenseClaimDto,
  UpdateExpenseClaimDto,
  ReviewExpenseClaimDto,
  ExpenseClaimQueryDto,
} from './dto/expense.dto';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpensesController {
  constructor(private expensesService: ExpensesService) {}

  // ============================================
  // Expense Categories (Admin)
  // ============================================

  @Get('categories')
  @ApiOperation({ summary: 'Get all expense categories' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.expensesService.getCategories(user.tenantId);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create expense category' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseCategoryDto,
  ) {
    return this.expensesService.createCategory(user.tenantId, dto);
  }

  @Put('categories/:id')
  @ApiOperation({ summary: 'Update expense category' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.expensesService.updateCategory(user.tenantId, id, dto);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Delete expense category' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async deleteCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.expensesService.deleteCategory(user.tenantId, id);
    return { message: 'Expense category deleted' };
  }

  // ============================================
  // My Claims (Employee)
  // ============================================

  @Get('my-claims')
  @ApiOperation({ summary: 'Get my expense claims' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyClaims(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExpenseClaimQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    return this.expensesService.getMyClaims(user.tenantId, user.employeeId, query);
  }

  @Post('claims')
  @ApiOperation({ summary: 'Create expense claim' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseClaimDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    return this.expensesService.createClaim(user.tenantId, user.employeeId, dto);
  }

  @Put('claims/:id')
  @ApiOperation({ summary: 'Update expense claim' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseClaimDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    return this.expensesService.updateClaim(user.tenantId, user.employeeId, id, dto);
  }

  @Post('claims/:id/submit')
  @ApiOperation({ summary: 'Submit expense claim' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async submitClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    return this.expensesService.submitClaim(user.tenantId, user.employeeId, id);
  }

  @Delete('claims/:id')
  @ApiOperation({ summary: 'Delete expense claim' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    await this.expensesService.deleteClaim(user.tenantId, user.employeeId, id);
    return { message: 'Expense claim deleted' };
  }

  // ============================================
  // Approvals (HR / Manager)
  // ============================================

  @Get('pending-approvals')
  @ApiOperation({ summary: 'Get pending expense approvals' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getPendingApprovals(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExpenseClaimQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('No employee profile linked to this user');
    }
    return this.expensesService.getPendingApprovals(
      user.tenantId,
      user.employeeId,
      user.role,
      query,
    );
  }

  @Get('all-claims')
  @ApiOperation({ summary: 'Get all expense claims' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getAllClaims(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExpenseClaimQueryDto,
  ) {
    return this.expensesService.getAllClaims(user.tenantId, query);
  }

  @Post('claims/:id/approve')
  @ApiOperation({ summary: 'Approve expense claim' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async approveClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewExpenseClaimDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.expensesService.approveClaim(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
      dto,
    );
  }

  @Post('claims/:id/reject')
  @ApiOperation({ summary: 'Reject expense claim' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async rejectClaim(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewExpenseClaimDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.expensesService.rejectClaim(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
      dto,
    );
  }

  @Post('claims/:id/reimburse')
  @ApiOperation({ summary: 'Mark claim as reimbursed' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async markReimbursed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.expensesService.markReimbursed(user.tenantId, id);
  }
}
