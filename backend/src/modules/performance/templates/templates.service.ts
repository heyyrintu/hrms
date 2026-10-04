import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReviewCycleStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateQuestionDto,
  CreateTemplateDto,
  TemplateEntryDto,
  UpdateQuestionDto,
  UpdateTemplateDto,
} from './dto/templates.dto';

const TEMPLATE_INCLUDE = {
  questions: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      question: { select: { id: true, text: true, type: true, isActive: true } },
    },
  },
};

/** Question bank and review templates (spec F2). Admin-only; the controller enforces roles. */
@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // Question bank
  // ============================================

  /** Number of distinct templates that use each question. */
  private async usageByQuestion(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.reviewTemplateQuestion.findMany({
      where: { tenantId },
      select: { questionId: true, templateId: true },
    });
    const templates = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!templates.has(r.questionId)) templates.set(r.questionId, new Set());
      templates.get(r.questionId)!.add(r.templateId);
    }
    return new Map([...templates].map(([id, set]) => [id, set.size]));
  }

  async listQuestions(tenantId: string) {
    const [questions, usage] = await Promise.all([
      this.prisma.reviewQuestion.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
      this.usageByQuestion(tenantId),
    ]);
    return questions.map((q) => ({ ...q, usedByTemplates: usage.get(q.id) ?? 0 }));
  }

  async createQuestion(tenantId: string, dto: CreateQuestionDto) {
    const created = await this.prisma.reviewQuestion.create({
      data: {
        tenantId,
        text: dto.text,
        type: dto.type,
        category: dto.category,
        isActive: dto.isActive ?? true,
      },
    });
    return { ...created, usedByTemplates: 0 };
  }

  async updateQuestion(tenantId: string, id: string, dto: UpdateQuestionDto) {
    const existing = await this.prisma.reviewQuestion.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Question not found');

    const data: Prisma.ReviewQuestionUpdateInput = {};
    if (dto.text !== undefined) data.text = dto.text;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.reviewQuestion.update({ where: { id }, data });
    const usage = await this.usageByQuestion(tenantId);
    return { ...updated, usedByTemplates: usage.get(id) ?? 0 };
  }

  async deleteQuestion(tenantId: string, id: string) {
    const existing = await this.prisma.reviewQuestion.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Question not found');

    const used = await this.prisma.reviewTemplateQuestion.count({
      where: { tenantId, questionId: id },
    });
    if (used > 0) {
      throw new BadRequestException(
        'This question is used by a template. Deactivate it instead of deleting it.',
      );
    }

    await this.prisma.reviewQuestion.delete({ where: { id } });
    return { message: 'Question deleted' };
  }

  // ============================================
  // Templates
  // ============================================

  async listTemplates(tenantId: string) {
    return this.prisma.reviewTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: TEMPLATE_INCLUDE,
    });
  }

  async getTemplate(tenantId: string, id: string) {
    const template = await this.prisma.reviewTemplate.findFirst({
      where: { id, tenantId },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async createTemplate(tenantId: string, dto: CreateTemplateDto) {
    await this.assertNameFree(tenantId, dto.name);
    await this.validateEntries(tenantId, dto.questions);

    let templateId: string;
    try {
      templateId = await this.prisma.$transaction(async (tx) => {
        const template = await tx.reviewTemplate.create({
          data: {
            tenantId,
            name: dto.name,
            description: dto.description,
            isActive: dto.isActive ?? true,
          },
        });
        await tx.reviewTemplateQuestion.createMany({
          data: this.entryRows(tenantId, template.id, dto.questions),
        });
        return template.id;
      });
    } catch (e) {
      throw this.mapUniqueError(e);
    }

    return this.getTemplate(tenantId, templateId);
  }

  async updateTemplate(tenantId: string, id: string, dto: UpdateTemplateDto) {
    const existing = await this.prisma.reviewTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Template not found');

    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameFree(tenantId, dto.name, id);
    }
    if (dto.questions !== undefined) {
      await this.validateEntries(tenantId, dto.questions);
    }

    const data: Prisma.ReviewTemplateUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) {
          await tx.reviewTemplate.update({ where: { id }, data });
        }
        if (dto.questions !== undefined) {
          await tx.reviewTemplateQuestion.deleteMany({
            where: { templateId: id, tenantId },
          });
          await tx.reviewTemplateQuestion.createMany({
            data: this.entryRows(tenantId, id, dto.questions),
          });
        }
      });
    } catch (e) {
      throw this.mapUniqueError(e);
    }

    return this.getTemplate(tenantId, id);
  }

  async deleteTemplate(tenantId: string, id: string) {
    const existing = await this.prisma.reviewTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Template not found');

    const draftCycles = await this.prisma.reviewCycle.count({
      where: { tenantId, templateId: id, status: ReviewCycleStatus.DRAFT },
    });
    if (draftCycles > 0) {
      throw new BadRequestException(
        'A draft review cycle uses this template. Change the cycle first.',
      );
    }

    await this.prisma.reviewTemplate.delete({ where: { id } });
    return { message: 'Template deleted' };
  }

  // ============================================
  // Helpers
  // ============================================

  private async assertNameFree(tenantId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.reviewTemplate.findFirst({
      where: { tenantId, name },
      select: { id: true },
    });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException('A template with this name already exists');
    }
  }

  /** Every question in the tenant (404) and active (400); no duplicate (question, audience) (400). */
  private async validateEntries(tenantId: string, entries: TemplateEntryDto[]) {
    if (entries.length < 1 || entries.length > 50) {
      throw new BadRequestException('A template needs between 1 and 50 questions');
    }

    const pairs = new Set<string>();
    for (const e of entries) {
      const key = `${e.questionId}:${e.audience}`;
      if (pairs.has(key)) {
        throw new BadRequestException(
          'Duplicate question for the same audience in this template',
        );
      }
      pairs.add(key);
    }

    const ids = [...new Set(entries.map((e) => e.questionId))];
    const found = await this.prisma.reviewQuestion.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, isActive: true },
    });
    if (found.length !== ids.length) {
      throw new NotFoundException('One or more questions were not found');
    }
    if (found.some((q) => !q.isActive)) {
      throw new BadRequestException('Inactive questions cannot be added to a template');
    }
  }

  private entryRows(tenantId: string, templateId: string, entries: TemplateEntryDto[]) {
    return entries.map((e, index) => ({
      tenantId,
      templateId,
      questionId: e.questionId,
      audience: e.audience,
      isRequired: e.isRequired ?? true,
      sortOrder: e.sortOrder ?? index,
    }));
  }

  /** A lost unique-name race surfaces as P2002; report it as the same 409. */
  private mapUniqueError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('A template with this name already exists');
    }
    return e;
  }
}
