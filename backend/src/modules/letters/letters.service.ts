import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as Handlebars from 'handlebars';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
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
      joinDate: employee.joinDate ? new Date(employee.joinDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '',
      exitDate: employee.exitDate ? new Date(employee.exitDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '',
      companyName: employee.tenant?.name ?? '',
      companyAddress,
      currentDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
      managerName: employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '',
    };

    let renderedContent: string;
    try {
      const compiled = Handlebars.compile(template.content);
      renderedContent = compiled(variables);
    } catch {
      throw new BadRequestException('Failed to render template — check template syntax');
    }

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

  async getGeneratedLetter(tenantId: string, id: string) {
    const letter = await this.prisma.letterGenerated.findFirst({
      where: { id, tenantId },
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

  async generatePdf(tenantId: string, id: string): Promise<Buffer> {
    const letter = await this.getGeneratedLetter(tenantId, id);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 60, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header line
      doc
        .rect(0, 0, doc.page.width, 6)
        .fill('#1a56db');

      // Letter type badge
      const typeName = letter.template.type.replace(/_/g, ' ');
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#6b7280')
        .text(typeName, 60, 30, { align: 'right' });

      // Date
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#374151')
        .text(`Date: ${new Date(letter.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`, 60, 50);

      // Employee info
      doc
        .moveDown(0.5)
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#111827')
        .text(`${letter.employee.firstName} ${letter.employee.lastName}`);

      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#6b7280')
        .text(`${letter.employee.employeeCode} · ${letter.employee.department?.name ?? ''}`);

      // Divider
      const divY = doc.y + 12;
      doc.moveTo(60, divY).lineTo(535, divY).strokeColor('#e5e7eb').lineWidth(1).stroke();

      // Content — render the HTML as plain text (strip tags)
      const plainContent = letter.content
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();

      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor('#111827')
        .text(plainContent, 60, divY + 16, {
          width: 475,
          lineGap: 4,
          paragraphGap: 8,
        });

      // Footer
      const footY = doc.page.height - 60;
      doc
        .moveTo(60, footY)
        .lineTo(535, footY)
        .strokeColor('#e5e7eb')
        .lineWidth(0.5)
        .stroke();

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#9ca3af')
        .text('This is a computer-generated document.', 60, footY + 6, {
          align: 'center',
          width: 475,
        });

      doc.end();
    });
  }
}
