import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { formatLetterDate, renderLetterContent, renderLetterPdf } from './letter-render';

/** Sentinel that can never match a real employee id. */
const NO_EMPLOYEE = '__no-employee__';

import {
  CreateLetterTemplateDto,
  UpdateLetterTemplateDto,
  GenerateLetterDto,
  LetterQueryDto,
} from './dto/letter.dto';

@Injectable()
export class LettersService {
  private readonly logger = new Logger(LettersService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  // ── Template CRUD ──────────────────────────────────────────

  async createTemplate(tenantId: string, dto: CreateLetterTemplateDto) {
    return this.prisma.letterTemplate.create({
      data: { tenantId, ...dto },
    });
  }

  async getTemplates(tenantId: string, query: LetterQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.type) where.type = query.type;
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    return this.prisma.letterTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTemplate(tenantId: string, id: string) {
    const template = await this.prisma.letterTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async updateTemplate(tenantId: string, id: string, dto: UpdateLetterTemplateDto) {
    await this.getTemplate(tenantId, id);
    return this.prisma.letterTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async deleteTemplate(tenantId: string, id: string) {
    await this.getTemplate(tenantId, id);
    await this.prisma.letterTemplate.delete({ where: { id } });
    return { message: 'Template deleted' };
  }

  // ── Letter Generation ──────────────────────────────────────

  async generateLetter(tenantId: string, generatedBy: string, dto: GenerateLetterDto) {
    const template = await this.prisma.letterTemplate.findFirst({
      where: { id: dto.templateId, tenantId, isActive: true },
    });
    if (!template) throw new NotFoundException('Template not found or inactive');

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
      include: {
        department: true,
        designation: true,
        branch: true,
        manager: true,
        tenant: { select: { name: true, addressLine1: true, city: true, state: true, pinCode: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const companyAddress = [
      employee.tenant?.addressLine1,
      employee.tenant?.city,
      employee.tenant?.state,
      employee.tenant?.pinCode,
    ].filter(Boolean).join(', ');

    const variables: Record<string, string> = {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeCode: employee.employeeCode,
      designation: employee.designation?.name ?? '',
      department: employee.department?.name ?? '',
      branch: employee.branch?.name ?? '',
      email: employee.email,
      joinDate: employee.joinDate ? formatLetterDate(employee.joinDate) : '',
      exitDate: employee.exitDate ? formatLetterDate(employee.exitDate) : '',
      companyName: employee.tenant?.name ?? '',
      companyAddress,
      currentDate: formatLetterDate(new Date()),
      managerName: employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '',
    };

    // Isolated Handlebars environment, proto access refused (letter-render.ts).
    const renderedContent = renderLetterContent(template.content, variables);

    const letter = await this.prisma.letterGenerated.create({
      data: {
        tenantId,
        templateId: template.id,
        employeeId: employee.id,
        content: renderedContent,
        generatedBy,
      },
      include: {
        template: { select: { name: true, type: true } },
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    // Notify employee via email (fire and forget)
    this.emailService.sendEmail({
      to: employee.email,
      subject: `New Letter Generated: ${template.name}`,
      template: 'letter-generated',
      context: {
        employeeName: `${employee.firstName} ${employee.lastName}`,
        letterType: template.type.replace(/_/g, ' '),
        templateName: template.name,
        generatedDate: new Date().toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        }),
      },
    }).catch((err) => {
      this.logger.error(`Failed to send letter notification email: ${err}`);
    });

    return letter;
  }

  // ── Generated Letters ──────────────────────────────────────

  async getGeneratedLetters(tenantId: string) {
    return this.prisma.letterGenerated.findMany({
      where: { tenantId },
      include: {
        template: { select: { name: true, type: true } },
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async getMyLetters(tenantId: string, employeeId: string) {
    return this.prisma.letterGenerated.findMany({
      where: { tenantId, employeeId },
      include: {
        template: { select: { name: true, type: true } },
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  /**
   * Fetch one generated letter. Admin roles may read any letter in the tenant;
   * everyone else only the letters addressed to their own employee record.
   */
  async getGeneratedLetter(
    tenantId: string,
    id: string,
    requester?: Pick<AuthenticatedUser, 'role' | 'employeeId'>,
  ) {
    const isAdmin =
      requester?.role === UserRole.SUPER_ADMIN || requester?.role === UserRole.HR_ADMIN;
    const where =
      requester && !isAdmin
        ? { id, tenantId, employeeId: requester.employeeId ?? NO_EMPLOYEE }
        : { id, tenantId };

    const letter = await this.prisma.letterGenerated.findFirst({
      where,
      include: {
        template: { select: { name: true, type: true } },
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            email: true,
            designation: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    if (!letter) throw new NotFoundException('Letter not found');
    return letter;
  }

  // ── PDF Generation ─────────────────────────────────────────

  async generatePdf(
    tenantId: string,
    id: string,
    requester?: Pick<AuthenticatedUser, 'role' | 'employeeId'>,
  ): Promise<Buffer> {
    const letter = await this.getGeneratedLetter(tenantId, id, requester);

    return renderLetterPdf({
      badge: letter.template.type.replace(/_/g, ' '),
      date: letter.generatedAt,
      recipientName: `${letter.employee.firstName} ${letter.employee.lastName}`,
      recipientLine: `${letter.employee.employeeCode} · ${letter.employee.department?.name ?? ''}`,
      content: letter.content,
    });
  }
}
