import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { RejectLoanDto } from './dto/reject-loan.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { ListLoansDto } from './dto/list-loans.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('loans')
@ApiBearerAuth()
@Controller('loans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LoansController {
  constructor(private loansService: LoansService) {}

  /**
   * Request a loan or a salary advance
   * POST /api/loans
   */
  @Post()
  @ApiOperation({ summary: 'Request a loan or salary advance' })
  @ApiResponse({ status: 201, description: 'Request recorded' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLoanDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.loansService.create(user.tenantId, user.employeeId, dto);
  }

  /**
   * My own loans
   * GET /api/loans/my
   *
   * Declared before `:id` so "my" is not swallowed as a loan id.
   */
  @Get('my')
  @ApiOperation({ summary: 'List my loans and advances' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findMy(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLoansDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.loansService.findMy(user.tenantId, user.employeeId, query);
  }

  /**
   * The HR queue, or a manager's view of their own reports.
   * GET /api/loans
   */
  @Get()
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List loans (HR sees the tenant, a manager sees their reports)',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLoansDto,
  ) {
    return this.loansService.findAll(
      user.tenantId,
      user.employeeId,
      user.role,
      query,
    );
  }

  /**
   * One loan, with its repayments and full instalment schedule.
   * GET /api/loans/:id
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get a loan with its repayments and schedule' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.loansService.findById(
      user.tenantId,
      id,
      user.employeeId,
      user.role,
    );
  }

  /**
   * Withdraw my own request while it is still pending.
   * POST /api/loans/:id/cancel
   */
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel my pending request' })
  @ApiResponse({ status: 201, description: 'Cancelled' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.loansService.cancel(user.tenantId, id, user.employeeId);
  }

  /**
   * POST /api/loans/:id/approve
   *
   * Managers deliberately do not get this: they may see their reports' loans
   * but the money decision stays with HR.
   */
  @Post(':id/approve')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Approve a loan request' })
  @ApiResponse({ status: 201, description: 'Approved' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.loansService.approve(user.tenantId, id, user.userId);
  }

  /**
   * POST /api/loans/:id/reject
   */
  @Post(':id/reject')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Reject a loan request' })
  @ApiResponse({ status: 201, description: 'Rejected' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectLoanDto,
  ) {
    return this.loansService.reject(user.tenantId, id, dto);
  }

  /**
   * POST /api/loans/:id/disburse
   */
  @Post(':id/disburse')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Mark an approved loan as disbursed' })
  @ApiResponse({ status: 201, description: 'Disbursed' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async disburse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.loansService.disburse(user.tenantId, id);
  }

  /**
   * A repayment made outside payroll.
   * POST /api/loans/:id/repayments
   */
  @Post(':id/repayments')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Record a manual repayment against a loan' })
  @ApiResponse({ status: 201, description: 'Repayment recorded' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async recordRepayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordRepaymentDto,
  ) {
    return this.loansService.recordRepayment(user.tenantId, id, dto);
  }
}
