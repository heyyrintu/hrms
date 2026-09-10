import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { StorageService } from '../../../common/storage/storage.service';
import { ProofsService } from './proofs.service';
import {
  ApproveProofDto,
  MyProofsQueryDto,
  ProofQueueQueryDto,
  RejectProofDto,
  SubmitProofDto,
} from './dto/proofs.dto';

/** Roles that review proofs. A manager is deliberately not among them. */
const PAYROLL_STAFF: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.HR_ADMIN];

/**
 * Header values must not carry quotes or control characters, and a filename
 * arrives from whoever uploaded the document. Stripping both keeps a crafted
 * name from breaking out of the `filename="..."` parameter.
 */
function safeFilename(fileName: string): string {
  // eslint-disable-next-line no-control-regex
  return fileName.replace(/[\r\n"\\\x00-\x1f]/g, '_');
}

/**
 * Investment proof endpoints.
 *
 * Split in two. The employee routes carry no `@Roles`, because every employee
 * has to reach their own records and `RolesGuard` lets an undecorated handler
 * through — the same arrangement as the statutory module's `my-declaration`.
 * They are safe to leave open because each one is scoped to the caller's own
 * employee id inside the service, never to an id taken from the request.
 *
 * The review routes are restricted to payroll staff. A manager gets nothing:
 * what a subordinate invests in or insures is not a line-management matter, and
 * only the people who have to check the documents need to see them.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/proofs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProofsController {
  constructor(
    private proofsService: ProofsService,
    private storageService: StorageService,
  ) {}

  // -------------------------------------------------------------------------
  // Payroll staff
  // -------------------------------------------------------------------------

  @Get()
  @Roles(...PAYROLL_STAFF)
  @ApiOperation({
    summary: 'The review queue',
    description:
      'Every proof in the tenant, oldest first, narrowed by any of the filters given.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProofQueueQueryDto,
  ) {
    return this.proofsService.list(user.tenantId, query);
  }

  @Get('employees/:employeeId/summary')
  @Roles(...PAYROLL_STAFF)
  @ApiOperation({
    summary: "Declared against claimed against approved, for one employee",
    description: 'FY 2026-27 is 2026. Defaults to the financial year in progress.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async employeeSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query() query: MyProofsQueryDto,
  ) {
    return this.proofsService.summary(
      user.tenantId,
      employeeId,
      query.financialYear,
    );
  }

  // -------------------------------------------------------------------------
  // Employee
  // -------------------------------------------------------------------------

  @Post()
  @ApiOperation({
    summary: 'File a document as evidence for one deduction head',
    description:
      'Upload the file through POST /uploads first and pass the resulting id. The upload ' +
      'must be your own: a proof pointing at somebody else\'s document is refused.',
  })
  @ApiResponse({ status: 201, description: 'Filed, awaiting review' })
  @ApiResponse({ status: 400, description: 'No such upload, or nothing claimed' })
  @ApiResponse({ status: 403, description: 'The upload belongs to somebody else' })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitProofDto,
  ) {
    return this.proofsService.submit(
      user.tenantId,
      user.employeeId,
      user.userId,
      dto,
    );
  }

  @Get('mine')
  @ApiOperation({
    summary: 'Your own proofs for a financial year',
    description: 'FY 2026-27 is 2026. Defaults to the financial year in progress.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyProofsQueryDto,
  ) {
    return this.proofsService.listMine(
      user.tenantId,
      user.employeeId,
      query.financialYear,
    );
  }

  @Get('mine/summary')
  @ApiOperation({
    summary: 'What you declared, what you have claimed, and what has been approved',
    description:
      'Per deduction head, for one financial year, with whether verified amounts are ' +
      'currently replacing declared ones in the TDS calculation.',
  })
  @ApiResponse({ status: 200, description: 'Success' })
  async mySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyProofsQueryDto,
  ) {
    return this.proofsService.summary(
      user.tenantId,
      user.employeeId,
      query.financialYear,
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Withdraw a proof you filed',
    description: 'Only while it is still pending; a decision cannot be unmade by its subject.',
  })
  @ApiResponse({ status: 200, description: 'Withdrawn' })
  @ApiResponse({ status: 404, description: 'Not one of your proofs' })
  @ApiResponse({ status: 409, description: 'Already reviewed' })
  async withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.proofsService.withdraw(user.tenantId, user.employeeId, id);
    return { message: 'Proof withdrawn' };
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Download the document behind a proof',
    description:
      'Your own proofs, or any in the tenant for payroll staff, who cannot review a ' +
      'document they cannot open.',
  })
  @ApiResponse({ status: 200, description: 'The stored file' })
  @ApiResponse({ status: 404, description: 'Not found, or not yours' })
  async downloadFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const upload = await this.proofsService.fileFor(user.tenantId, id, {
      employeeId: user.employeeId,
      isPayrollStaff: PAYROLL_STAFF.includes(user.role),
    });

    // The path is derived from the stored key, never from anything the caller
    // sent, so there is nothing here for a traversal attempt to work on.
    const filePath = await this.storageService.getFilePath(upload.key);

    res.setHeader('Content-Type', upload.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename(upload.fileName)}"`,
    );
    res.sendFile(filePath);
  }

  @Post(':id/approve')
  @Roles(...PAYROLL_STAFF)
  @ApiOperation({
    summary: 'Accept a proof, in whole or in part',
    description:
      'The verified amount may be lower than what was claimed, never higher.',
  })
  @ApiResponse({ status: 201, description: 'Approved' })
  @ApiResponse({ status: 400, description: 'Verified more than was claimed' })
  @ApiResponse({ status: 409, description: 'Already decided' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveProofDto,
  ) {
    return this.proofsService.approve(user.tenantId, user.userId, id, dto);
  }

  @Post(':id/reject')
  @Roles(...PAYROLL_STAFF)
  @ApiOperation({
    summary: 'Refuse a proof, with a reason',
    description:
      'The reason is required and no verified amount is stored, because nothing was accepted.',
  })
  @ApiResponse({ status: 201, description: 'Rejected' })
  @ApiResponse({ status: 400, description: 'No reason given' })
  @ApiResponse({ status: 409, description: 'Already decided' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectProofDto,
  ) {
    return this.proofsService.reject(user.tenantId, user.userId, id, dto);
  }
}
