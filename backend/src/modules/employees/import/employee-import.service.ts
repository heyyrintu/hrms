import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EmploymentType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service';
import { CsvParseError, isBlankRow, parseCsv } from './csv-parser';
import {
  IMPORT_COLUMNS,
  IMPORT_COLUMN_ALIASES,
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

/** The fields of a freshly created employee that the import hands onwards. */
interface CreatedEmployee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  departmentId: string | null;
  designationId: string | null;
  joinDate: Date;
}

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
  designationName: string;
  branchName: string;
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
    private webhookDispatcher: WebhookDispatcherService,
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

    const createdEmployees = await this.createAll(
      tenantId,
      userId,
      parsed,
      options.initialPassword,
    );
    result.created = createdEmployees.length;

    // The transaction has committed. One event per employee so a subscriber
    // sees an import exactly as it would see the same people added by hand.
    // Not awaited — a 2,000-row import must not wait on delivery — and sent
    // one after another rather than all at once (see announceCreated).
    void this.announceCreated(tenantId, createdEmployees);

    return result;
  }

  /**
   * Fire `employee.created` for each imported employee, strictly one at a
   * time, in the background.
   *
   * Each dispatch looks up the tenant's subscriptions, POSTs to every
   * endpoint with retries, writes delivery logs and may notify admins.
   * Starting them all at once would put up to 2,000 of those in flight
   * against the database and the customer's endpoint. One loop, awaiting
   * each in turn, keeps that to one. A failure on one employee is logged and
   * the loop carries on; nothing here ever rejects, so the caller can `void`
   * it.
   */
  private async announceCreated(
    tenantId: string,
    employees: CreatedEmployee[],
  ): Promise<void> {
    for (const employee of employees) {
      try {
        await this.webhookDispatcher.dispatch(tenantId, 'employee.created', {
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email,
          departmentId: employee.departmentId ?? null,
          designationId: employee.designationId ?? null,
          dateOfJoining: employee.joinDate.toISOString().slice(0, 10),
          source: 'import',
        });
      } catch (error) {
        this.logger.error(
          `employee.created webhook for imported employee ${employee.id} failed: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
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
      const aliased = IMPORT_COLUMN_ALIASES[key] ?? key;
      const known = IMPORT_COLUMNS.find((c) => c.toLowerCase() === aliased.toLowerCase());
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
      // Stored exactly as the operator typed it, because nothing else in the
      // system normalises case — EmployeesService.create writes the address
      // verbatim and AuthService.login matches it exactly. Normalising here
      // would create an account nobody can log in to. The duplicate checks
      // below are case-insensitive instead, so the collision is *caught*.
      email: at('email'),
      joinDate: at('joinDate'),
      departmentCode: at('departmentCode'),
      designationName: at('designationName'),
      branchName: at('branchName'),
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
    const uniqueEmails = [...new Set(emails)];
    const departmentCodes = rows.map((r) => r.departmentCode).filter(Boolean);
    const designationNames = rows.map((r) => r.designationName).filter(Boolean);
    const branchNames = rows.map((r) => r.branchName).filter(Boolean);

    const [existingEmployees, existingUsers, departments, designations, branches] =
      await Promise.all([
        // Postgres string equality is case-sensitive and so is
        // @@unique([tenantId, email]) — an exact `in` would miss
        // `John.Doe@acme.com` when the file says `john.doe@acme.com` and the
        // importer would happily create a second, unreachable account.
        this.prisma.employee.findMany({
          where: {
            tenantId,
            OR: [
              { employeeCode: { in: [...new Set([...employeeCodes, ...managerCodes])] } },
              ...uniqueEmails.map((e) => ({
                email: { equals: e, mode: 'insensitive' as const },
              })),
            ],
          },
          select: { id: true, employeeCode: true, email: true },
        }),
        this.prisma.user.findMany({
          where: {
            tenantId,
            OR: uniqueEmails.map((e) => ({
              email: { equals: e, mode: 'insensitive' as const },
            })),
          },
          select: { email: true },
        }),
        this.prisma.department.findMany({
          where: { tenantId, code: { in: [...new Set(departmentCodes)] } },
          select: { id: true, code: true },
        }),
        // Designation and Branch carry no `code` column in the schema; they
        // are unique on `name` per tenant, which is why the CSV columns are
        // `designationName` / `branchName`. The retired `*Code` spellings are
        // still accepted as header aliases.
        this.prisma.designation.findMany({
          where: { tenantId, name: { in: [...new Set(designationNames)] } },
          select: { id: true, name: true },
        }),
        this.prisma.branch.findMany({
          where: { tenantId, name: { in: [...new Set(branchNames)] } },
          select: { id: true, name: true },
        }),
      ]);

    const takenCodes = new Set((existingEmployees ?? []).map((e) => e.employeeCode));
    const takenEmails = new Set(
      (existingEmployees ?? []).map((e) => (e.email ?? '').toLowerCase()),
    );
    for (const u of existingUsers ?? []) takenEmails.add((u.email ?? '').toLowerCase());

    const departmentByCode = new Map((departments ?? []).map((d) => [d.code, d.id]));
    const designationByName = new Map((designations ?? []).map((d) => [d.name, d.id]));
    const branchByName = new Map((branches ?? []).map((b) => [b.name, b.id]));
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
        // Folded for comparison only; the row keeps the operator's spelling.
        const emailKey = r.email.toLowerCase();
        const seenAt = emailFirstSeen.get(emailKey);
        if (seenAt !== undefined) {
          add(r.row, 'email', `"${r.email}" is duplicated (first seen on row ${seenAt})`);
        } else {
          emailFirstSeen.set(emailKey, r.row);
        }
        if (takenEmails.has(emailKey)) {
          add(r.row, 'email', `"${r.email}" already exists in this tenant`);
        }
      }

      if (r.departmentCode && !departmentByCode.has(r.departmentCode)) {
        add(r.row, 'departmentCode', `"${r.departmentCode}" does not match any department`);
      }
      if (r.designationName && !designationByName.has(r.designationName)) {
        add(r.row, 'designationName', `"${r.designationName}" does not match any designation`);
      }
      if (r.branchName && !branchByName.has(r.branchName)) {
        add(r.row, 'branchName', `"${r.branchName}" does not match any branch`);
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
   * Creates every employee and its user account in one transaction, together
   * with the audit entry that records the import — so there is never an
   * import without its audit row, nor an audit row for an import that rolled
   * back. Rows are created in file order so a manager referenced by a later
   * row already has an id by the time that row is written.
   */
  private async createAll(
    tenantId: string,
    userId: string,
    rows: ParsedRow[],
    initialPassword: string,
  ): Promise<CreatedEmployee[]> {
    const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);

    const employeeCodes = rows.map((r) => r.employeeCode);
    const managerCodes = rows.map((r) => r.managerEmployeeCode).filter(Boolean);
    const departmentCodes = rows.map((r) => r.departmentCode).filter(Boolean);
    const designationNames = rows.map((r) => r.designationName).filter(Boolean);
    const branchNames = rows.map((r) => r.branchName).filter(Boolean);

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
        where: { tenantId, name: { in: [...new Set(designationNames)] } },
        select: { id: true, name: true },
      }),
      this.prisma.branch.findMany({
        where: { tenantId, name: { in: [...new Set(branchNames)] } },
        select: { id: true, name: true },
      }),
    ]);

    const departmentByCode = new Map((departments ?? []).map((d) => [d.code, d.id]));
    const designationByName = new Map((designations ?? []).map((d) => [d.name, d.id]));
    const branchByName = new Map((branches ?? []).map((b) => [b.name, b.id]));
    const employeeIdByCode = new Map<string, string>(
      (existingManagers ?? []).map((e) => [e.employeeCode, e.id]),
    );

    return this.prisma.$transaction(async (tx) => {
      const created: CreatedEmployee[] = [];

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
            designationId: r.designationName
              ? (designationByName.get(r.designationName) ?? null)
              : null,
            branchId: r.branchName ? (branchByName.get(r.branchName) ?? null) : null,
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

        created.push(employee);
      }

      await this.audit.log(
        {
          tenantId,
          userId,
          action: 'CREATE',
          entityType: 'EmployeeImport',
          newValues: {
            totalRows: rows.length,
            created: created.length,
            employeeCodes: rows.map((r) => r.employeeCode),
          },
        },
        tx,
      );

      return created;
    });
  }
}
