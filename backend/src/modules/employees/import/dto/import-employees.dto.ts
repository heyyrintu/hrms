import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Largest CSV we accept, in bytes. Also enforced by multer on the interceptor. */
export const MAX_IMPORT_FILE_SIZE = 2 * 1024 * 1024;

/** Largest number of data rows (header excluded) we accept in one import. */
export const MAX_IMPORT_ROWS = 2000;

/** Columns the importer understands. Header matching is case-insensitive. */
export const IMPORT_COLUMNS = [
  'employeeCode',
  'firstName',
  'lastName',
  'email',
  'joinDate',
  'departmentCode',
  'designationName',
  'branchName',
  'managerEmployeeCode',
  'employmentType',
  'phone',
  'dateOfBirth',
  'gender',
  'role',
] as const;

/**
 * Header spellings retired in favour of the canonical ones above, still
 * accepted so a CSV written against the first release keeps importing.
 * Designation and Branch are matched by *name* — there is no code column on
 * either model — so `*Code` actively misled the operator.
 */
export const IMPORT_COLUMN_ALIASES: Record<string, string> = {
  designationcode: 'designationName',
  branchcode: 'branchName',
};

export const REQUIRED_IMPORT_COLUMNS = [
  'employeeCode',
  'firstName',
  'lastName',
  'email',
  'joinDate',
] as const;

/** The downloadable template: the header line and nothing else. */
export const EMPLOYEE_IMPORT_TEMPLATE = `${IMPORT_COLUMNS.join(',')}\n`;

export class ImportEmployeesDto {
  @ApiPropertyOptional({
    description:
      'Password given to every user account created by this import. Required unless dryRun is true. Each account is flagged mustChangePassword.',
    minLength: 8,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  initialPassword?: string;
}

export class ImportEmployeesQueryDto {
  @ApiPropertyOptional({
    description: 'Validate the file and report errors without writing anything.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  dryRun?: boolean;
}

/** One problem with one cell of one data row. */
export interface ImportRowError {
  /** 1-based index of the data row, i.e. the header line is not counted. */
  row: number;
  field: string;
  message: string;
}

export interface ImportEmployeesResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ImportRowError[];
  created: number;
}
