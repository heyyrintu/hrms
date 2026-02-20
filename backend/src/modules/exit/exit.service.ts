import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { SeparationStatus } from '@prisma/client';
import {
  InitiateSeparationDto,
  UpdateSeparationDto,
  SeparationQueryDto,
} from './dto/exit.dto';

@Injectable()
export class ExitService {
  private readonly logger = new Logger(ExitService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  private readonly include = {
    employee: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        email: true,
        designation: true,
        department: { select: { name: true } },
        joinDate: true,
      },
    },
    processor: {
      select: { id: true, firstName: true, lastName: true },
    },
  };

  async initiate(tenantId: string, processedBy: string, dto: InitiateSeparationDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId, status: 'ACTIVE' },
    });
    if (!employee) throw new NotFoundException('Employee not found or already inactive');

    // Check for existing active separation
    const existing = await this.prisma.separation.findFirst({
      where: {
        tenantId,
        employeeId: dto.employeeId,
        status: { notIn: [SeparationStatus.COMPLETED, SeparationStatus.CANCELLED] },
      },
    });
    if (existing) throw new BadRequestException('An active separation already exists for this employee');

    const separation = await this.prisma.separation.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        type: dto.type,
        reason: dto.reason,
        lastWorkingDate: dto.lastWorkingDate ? new Date(dto.lastWorkingDate) : undefined,
        noticePeriodDays: dto.noticePeriodDays ?? 0,
        isNoticePeriodWaived: dto.isNoticePeriodWaived ?? false,
        processedBy,
      },
      include: this.include,
    });

    // Notify employee via email (fire and forget)
    this.emailService.sendEmail({
      to: employee.email,
      subject: 'Separation Process Initiated',
      template: 'exit-initiated',
      context: {
        employeeName: `${employee.firstName} ${employee.lastName}`,
        separationType: dto.type.replace(/_/g, ' '),
        lastWorkingDate: dto.lastWorkingDate
          ? new Date(dto.lastWorkingDate).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })
          : null,
        noticePeriodDays: dto.noticePeriodDays,
      },
    }).catch((err) => {
      this.logger.error(`Failed to send exit initiation email: ${err}`);
    });

    return separation;
  }

  async findAll(tenantId: string, query: SeparationQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;

    return this.prisma.separation.findMany({
      where,
      include: this.include,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const separation = await this.prisma.separation.findFirst({
      where: { id, tenantId },
      include: this.include,
    });
    if (!separation) throw new NotFoundException('Separation not found');
    return separation;
  }

  async update(tenantId: string, id: string, dto: UpdateSeparationDto) {
    const separation = await this.findOne(tenantId, id);
    if (separation.status === SeparationStatus.COMPLETED) {
      throw new BadRequestException('Cannot update a completed separation');
    }

    return this.prisma.separation.update({
      where: { id },
      data: {
        ...dto,
        lastWorkingDate: dto.lastWorkingDate ? new Date(dto.lastWorkingDate) : undefined,
      },
      include: this.include,
    });
  }

  async moveToNoticePeriod(tenantId: string, id: string) {
    const separation = await this.findOne(tenantId, id);
    if (separation.status !== SeparationStatus.INITIATED) {
      throw new BadRequestException('Can only move INITIATED separations to notice period');
    }

    return this.prisma.separation.update({
      where: { id },
      data: { status: SeparationStatus.NOTICE_PERIOD },
      include: this.include,
    });
  }

  async moveToClearance(tenantId: string, id: string) {
    const separation = await this.findOne(tenantId, id);
    if (separation.status !== SeparationStatus.NOTICE_PERIOD && separation.status !== SeparationStatus.INITIATED) {
      throw new BadRequestException('Can only move to clearance from INITIATED or NOTICE_PERIOD');
    }

    return this.prisma.separation.update({
      where: { id },
      data: { status: SeparationStatus.CLEARANCE_PENDING },
      include: this.include,
    });
  }

  async complete(tenantId: string, id: string) {
    const separation = await this.findOne(tenantId, id);
    if (separation.status === SeparationStatus.COMPLETED || separation.status === SeparationStatus.CANCELLED) {
      throw new BadRequestException('Separation is already completed or cancelled');
    }

    // Mark employee as INACTIVE and set exitDate
    await this.prisma.employee.update({
      where: { id: separation.employeeId },
      data: {
        status: 'INACTIVE',
        exitDate: separation.lastWorkingDate || new Date(),
      },
    });

    return this.prisma.separation.update({
      where: { id },
      data: {
        status: SeparationStatus.COMPLETED,
        completedAt: new Date(),
      },
      include: this.include,
    });
  }

  async cancel(tenantId: string, id: string) {
    const separation = await this.findOne(tenantId, id);
    if (separation.status === SeparationStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed separation');
    }

    return this.prisma.separation.update({
      where: { id },
      data: { status: SeparationStatus.CANCELLED },
      include: this.include,
    });
  }
}
