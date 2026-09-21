import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EmploymentType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CsvParseError, isBlankRow, parseCsv } from './csv-parser';
import {
  IMPORT_COLUMNS,
  ImportEmployeesResult,
  ImportRowError,
  MAX_IMPORT_FILE_SIZE,
  MAX_IMPORT_ROWS,
  REQUIRED_IMPORT_COLUMNS,
} from './dto/import-employees.dto';

const BCRYPT_ROUNDS = 10;

const EMPLOYMENT_TYPES = Object.values(EmploymentType) as string[];

/** Roles an import may hand out. SUPER_ADMIN is deliberately not one of them. */
const IMPORTABLE_ROLES: UserRole[] = [UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.HR_ADMIN];

/** Calendar dates in the CSV are plain YYYY-MM-DD. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export interface ImportOptions {
  dryRun: boolean;
  initialPassword?: string;
}

/** A data row after parsing, before it is known to be valid. */
interface ParsedRow {
  /** 1-based data-row number (the header line is not row 1). */
  row: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  joinDate: string;
  departmentCode: string;
  designationCode: string;
  branchCode: string;
  managerEmployeeCode: string;
  employmentType: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  role: string;
}

/**
 * Turns a YYYY-MM-DD string into the UTC noon instant for that calendar day.
 * Noon keeps the date from sliding either side of midnight when a reader in
 * another timezone formats it.
 */
export function toCalendarDate(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Rejects 2026-02-31, which Date would silently roll into March.
  return parsed.toISOString().slice(0, 10) === value;
}

@Injectable()
export class EmployeeImportService {
  private readonly logger = new Logger(EmployeeImportService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Validate a CSV of employees and, unless this is a dry run, create them all
   * in one transaction.
   *
   * The import is all-or-nothing: a single bad row rejects the whole file with
   * the complete error list, so an operator fixes the spreadsheet once rather
   * than discovering a half-imported tenant.
   */
  async importFromCsv(
    tenantId: string,
    userId: string,
    csv: string,
    options: ImportOptions,
  ): Promise<ImportEmployeesResult> {
    if (Buffer.byteLength(csv, 'utf8') > MAX_IMPORT_FILE_SIZE) {
      throw new BadRequestException(
        `CSV file is larger than ${MAX_IMPORT_FILE_SIZE / (1024 * 1024)} MB`,
      );
    }

    let grid: string[][];
    try {
      grid = parseCsv(csv);
    } catch (err) {
      if (err instanceof CsvParseError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const nonEmpty = grid.filter((row) => !isBlankRow(row));
    if (nonEmpty.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const columnIndex = this.mapHeader(nonEmpty[0]);
    const dataRows = nonEmpty.slice(1);

    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `CSV has ${dataRows.length} data rows; the maximum is ${MAX_IMPORT_ROWS}`,
      );
    }

    const parsed = dataRows.map((cells, i) => this.readRow(cells, columnIndex, i + 1));
    const errors = await this.validate(tenantId, parsed);

    const rowsWithErrors = new Set(errors.map((e) => e.row));
    const result: ImportEmployeesResult = {
      totalRows: parsed.length,
      validRows: parsed.length - rowsWithErrors.size,
      invalidRows: rowsWithErrors.size,
      errors,
      created: 0,
    };

    if (options.dryRun) {
      return result;
    }

    if (result.invalidRows > 0) {
      throw new BadRequestException({
        message: `Import rejected: ${result.invalidRows} of ${result.totalRows} rows are invalid`,
        ...result,
      });
    }

    if (!options.initialPassword || options.initialPassword.length < 8) {
      throw new BadRequestException(
        'initialPassword is required and must be at least 8 characters when dryRun is false',
      );
    }

    if (parsed.length === 0) {
      throw new BadRequestException('CSV file has no data rows');
    }

    result.created = await this.createAll(tenantId, parsed, options.initialPassword);

    await this.audit.log({
      tenantId,
      userId,
      action: 'CREATE',
      entityType: 'EmployeeImport',
      newValues: {
        totalRows: result.totalRows,
        created: result.created,
        employeeCodes: parsed.map((r) => r.employeeCode),
      },
    });

    return result;
  }

  /**
   * Header names are matched case-insensitively and with surrounding space
   * trimmed, so `Employee Code` style exports still line up once the space is
   * removed by the operator — but the canonical spelling is what we document.
   */
  private mapHeader(header: string[]): Record<string, number> {
    const index: Record<string, number> = {};
    header.forEach((raw, i) => {
      const key = raw.trim().toLowerCase();
      const known = IMPORT_COLUMNS.find((c) => c.toLowerCase() === key);
      if (known && index[known] === undefined) {
        index[known] = i;
      }
    });

    const missing = REQUIRED_IMPORT_COLUMNS.filter((c) => index[c] === undefined);
    if (missing.length > 0) {
      throw new BadRequestException(
        `CSV header is missing required column(s): ${missing.join(', ')}`,
      );
    }
    return index;
  }

  private readRow(cells: string[], index: Record<string, number>, row: number): ParsedRow {
    const at = (column: string) => {
      const i = index[column];
      if (i === undefined) return '';
      return (cells[i] ?? '').trim();
    };

    return {
      row,
      employeeCode: at('employeeCode'),
      firstName: at('firstName'),
      lastName: at('lastName'),
      email: at('email').toLowerCase(),
      joinDate: at('joinDate'),
      departmentCode: at('departmentCode'),
      designationCode: at('designationCode'),
      branchCode: at('branchCode'),
      managerEmployeeCode: at('managerEmployeeCode'),
      employmentType: at('employmentType').toUpperCase(),
      phone: at('phone'),
      dateOfBirth: at('dateOfBirth'),
      gender: at('gender'),
      role: at('role').toUpperCase(),
    };
  }

  private async validate(tenantId: string, rows: ParsedRow[]): Promise<ImportRowError[]> {
    const errors: ImportRowError[] = [];
    const add = (row: number, field: string, message: string) =>
      errors.push({ row, field, message });

    const employeeCodes = rows.map((r) => r.employeeCode).filter(Boolean);
    const managerCodes = rows.map((r) => r.managerEmployeeCode).filter(Boolean);
    const emails = rows.map((r) => r.email).filter(Boolean);
    const departmentCodes = rows.map((r) => r.departmentCode).filter(Boolean);
    const designationCodes = rows.map((r) => r.designationCode).filter(Boolean);
    const branchCodes = rows.map((r) => r.branchCode).filter(Boolean);

    const [existingEmployees, existingUsers, departments, designations, branches] =
      await Promise.all([
        this.prisma.employee.findMany({
          where: {
            tenantId,
            OR: [
              { employeeCode: { in: [...new Set([...employeeCodes, ...managerCodes])] } },
              { email: { in: [...new Set(emails)] } },
            ],
          },
          select: { id: true, employeeCode: true, email: true },
        }),
        this.prisma.user.findMany({
          where: { tenantId, email: { in: [...new Set(emails)] } },
          select: { email: true },
        }),
        this.prisma.department.findMany({
          where: { tenantId, code: { in: [...new Set(departmentCodes)] } },
          select: { id: true, code: true },
        }),
        // Designation and Branch carry no `code` column in the schema; they are
        // unique on `name` per tenant, so the CSV's *Code cells match by name.
        this.prisma.designation.findMany({
          where: { tenantId, name: { in: [...new Set(designationCodes)] } },
          select: { id: true, name: true },
        }),
        this.prisma.branch.findMany({
          where: { tenantId, name: { in: [...new Set(branchCodes)] } },
          select: { id: true, name: true },
        }),
      ]);

    const takenCodes = new Set((existingEmployees ?? []).map((e) => e.employeeCode));
    const takenEmails = new Set(
      (existingEmployees ?? []).map((e) => (e.email ?? '').toLowerCase()),
    );
    for (const u of existingUsers ?? []) takenEmails.add((u.email ?? '').toLowerCase());

    const departmentByCode = new Map((departments ?? []).map((d) => [d.code, d.id]));
    const designationByCode = new Map((designations ?? []).map((d) => [d.name, d.id]));
    const branchByCode = new Map((branches ?? []).map((b) => [b.name, b.id]));
    const managerCodesInTenant = new Set((existingEmployees ?? []).map((e) => e.employeeCode));

    const codeFirstSeen = new Map<string, number>();
    const emailFirstSeen = new Map<string, number>();
    const codesSoFar = new Set<string>();

    for (const r of rows) {
      for (const field of REQUIRED_IMPORT_COLUMNS) {
        if (!r[field]) add(r.row, field, `${field} is required`);
      }

      if (r.email && !EMAIL_PATTERN.test(r.email)) {
        add(r.row, 'email', `"${r.email}" is not a valid email address`);
      }
      if (r.joinDate && !isRealDate(r.joinDate)) {
        add(r.row, 'joinDate', `"${r.joinDate}" is not a valid date (expected YYYY-MM-DD)`);
      }
      if (r.dateOfBirth && !isRealDate(r.dateOfBirth)) {
        add(r.row, 'dateOfBirth', `"${r.dateOfBirth}" is not a valid date (expected YYYY-MM-DD)`);
      }
      if (r.employmentType && !EMPLOYMENT_TYPES.includes(r.employmentType)) {
        add(
          r.row,
          'employmentType',
          `"${r.employmentType}" must be one of ${EMPLOYMENT_TYPES.join(', ')}`,
        );
      }
      if (r.role && !IMPORTABLE_ROLES.includes(r.role as UserRole)) {
        add(r.row, 'role', `"${r.role}" must be one of ${IMPORTABLE_ROLES.join(', ')}`);
      }

      if (r.employeeCode) {
        const seenAt = codeFirstSeen.get(r.employeeCode);
        if (seenAt !== undefined) {
          add(r.row, 'employeeCode', `"${r.employeeCode}" is duplicated (first seen on row ${seenAt})`);
        } else {
          codeFirstSeen.set(r.employeeCode, r.row);
        }
        if (takenCodes.has(r.employeeCode)) {
          add(r.row, 'employeeCode', `"${r.employeeCode}" already exists in this tenant`);
        }
      }

      if (r.email) {
        const seenAt = emailFirstSeen.get(r.email);
        if (seenAt !== undefined) {
          add(r.row, 'email', `"${r.email}" is duplicated (first seen on row ${seenAt})`);
        } else {
          emailFirstSeen.set(r.email, r.row);
        }
        if (takenEmails.has(r.email)) {
          add(r.row, 'email', `"${r.email}" already exists in this tenant`);
        }
      }

      if (r.departmentCode && !departmentByCode.has(r.departmentCode)) {
        add(r.row, 'departmentCode', `"${r.departmentCode}" does not match any department`);
      }
      if (r.designationCode && !designationByCode.has(r.designationCode)) {
        add(r.row, 'designationCode', `"${r.designationCode}" does not match any designation`);
      }
      if (r.branchCode && !branchByCode.has(r.branchCode)) {
        add(r.row, 'branchCode', `"${r.branchCode}" does not match any branch`);
      }

      // A manager may be someone already in the tenant or someone created by an
      // earlier row of this same file, which is what makes a whole org chart
      // importable in one pass.
      if (
        r.managerEmployeeCode &&
        !managerCodesInTenant.has(r.managerEmployeeCode) &&
        !codesSoFar.has(r.managerEmployeeCode)
      ) {
        add(
          r.row,
          'managerEmployeeCode',
          `"${r.managerEmployeeCode}" does not match an employee in this tenant or an earlier row`,
        );
      }

      if (r.employeeCode) codesSoFar.add(r.employeeCode);
    }

    return errors;
  }

  /**
   * Creates every employee and its user account in one transaction. Rows are
   * created in file order so a manager referenced by a later row already has an
   * id by the time that row is written.
   */
  private async createAll(
    tenantId: string,
    rows: ParsedRow[],
    initialPassword: string,
  ): Promise<number> {
    const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);

    const employeeCodes = rows.map((r) => r.employeeCode);
    const managerCodes = rows.map((r) => r.managerEmployeeCode).filter(Boolean);
    const departmentCodes = rows.map((r) => r.departmentCode).filter(Boolean);
    const designationCodes = rows.map((r) => r.designationCode).filter(Boolean);
    const branchCodes = rows.map((r) => r.branchCode).filter(Boolean);

    const [existingManagers, departments, designations, branches] = await Promise.all([
      this.prisma.employee.findMany({
        where: { tenantId, employeeCode: { in: [...new Set(managerCodes)] } },
        select: { id: true, employeeCode: true },
      }),
      this.prisma.department.findMany({
        where: { tenantId, code: { in: [...new Set(departmentCodes)] } },
        select: { id: true, code: true },
      }),
      this.prisma.designation.findMany({
        where: { tenantId, name: { in: [...new Set(designationCodes)] } },
        select: { id: true, name: true },
      }),
      this.prisma.branch.findMany({
        where: { tenantId, name: { in: [...new Set(branchCodes)] } },
        select: { id: true, name: true },
      }),
    ]);

    const departmentByCode = new Map((departments ?? []).map((d) => [d.code, d.id]));
    const designationByCode = new Map((designations ?? []).map((d) => [d.name, d.id]));
    const branchByCode = new Map((branches ?? []).map((b) => [b.name, b.id]));
    const employeeIdByCode = new Map<string, string>(
      (existingManagers ?? []).map((e) => [e.employeeCode, e.id]),
    );

    return this.prisma.$transaction(async (tx) => {
      let created = 0;

      for (const r of rows) {
        const employee = await tx.employee.create({
          data: {
            tenantId,
            employeeCode: r.employeeCode,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            phone: r.phone || null,
            gender: r.gender || null,
            dateOfBirth: r.dateOfBirth ? toCalendarDate(r.dateOfBirth) : null,
            joinDate: toCalendarDate(r.joinDate),
            employmentType: (r.employmentType || EmploymentType.PERMANENT) as EmploymentType,
            departmentId: r.departmentCode
              ? (departmentByCode.get(r.departmentCode) ?? null)
              : null,
            designationId: r.designationCode
              ? (designationByCode.get(r.designationCode) ?? null)
              : null,
            branchId: r.branchCode ? (branchByCode.get(r.branchCode) ?? null) : null,
            managerId: r.managerEmployeeCode
              ? (employeeIdByCode.get(r.managerEmployeeCode) ?? null)
              : null,
            status: 'ACTIVE',
          },
        });

        employeeIdByCode.set(r.employeeCode, employee.id);

        await tx.user.create({
          data: {
            tenantId,
            email: r.email,
            passwordHash,
            role: (r.role || UserRole.EMPLOYEE) as UserRole,
            employeeId: employee.id,
            isActive: true,
            mustChangePassword: true,
          },
        });

        created += 1;
      }

      return created;
    });
  }
}
