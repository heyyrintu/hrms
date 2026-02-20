import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
  Matches,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanyDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'Code must contain only uppercase letters, numbers, hyphens, and underscores',
  })
  code: string;

  // Initial admin user for the company
  @ApiProperty()
  @IsEmail()
  adminEmail: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  adminPassword: string;

  @ApiProperty()
  @IsString()
  adminFirstName: string;

  @ApiProperty()
  @IsString()
  adminLastName: string;
}

export class UpdateCompanyDto {
  // ---- Basic Info ----
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({
    enum: ['PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'LLP', 'OPC', 'PARTNERSHIP', 'SOLE_PROPRIETORSHIP', 'TRUST', 'NGO', 'GOVERNMENT'],
  })
  @IsOptional()
  @IsString()
  companyType?: string;

  // ---- Registered Address ----
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  pinCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  // ---- Legal / Tax Identifiers ----
  @ApiPropertyOptional({ description: 'PAN: AAAAA9999A format' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'PAN must be in format AAAAA9999A' })
  pan?: string;

  @ApiPropertyOptional({ description: 'GSTIN: 15-character GST number' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'GSTIN must be a valid 15-character GST number',
  })
  gstin?: string;

  @ApiPropertyOptional({ description: 'TAN: AAAA99999A format' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{4}[0-9]{5}[A-Z]$/, { message: 'TAN must be in format AAAA99999A' })
  tan?: string;

  @ApiPropertyOptional({ description: 'CIN: Company Identification Number (21 chars, e.g. L17110MH1973PLC019786)' })
  @IsOptional()
  @IsString()
  @MaxLength(21)
  @Matches(/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/, {
    message: 'CIN must be in format L/U + 5 digits + 2 letters + 4 digits + 3 letters + 6 digits',
  })
  cin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  pfRegistrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  esiRegistrationNumber?: string;

  // ---- HR & Payroll Settings ----
  @ApiPropertyOptional({ description: 'IANA timezone string (e.g. Asia/Kolkata)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @ApiPropertyOptional({ description: 'ISO 4217 currency code (e.g. INR, USD)' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'Month when financial year starts (1=Jan, 4=Apr)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  financialYearStartMonth?: number;

  @ApiPropertyOptional({ description: 'Month when leave year starts (1=Jan, 4=Apr)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  leaveYearStartMonth?: number;

  @ApiPropertyOptional({ description: 'Number of working days per week (1-7)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  workDaysPerWeek?: number;

  @ApiPropertyOptional({ description: 'Standard working hours per day (e.g. 8)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  standardWorkHoursPerDay?: number;

  @ApiPropertyOptional({ enum: ['MONTHLY', 'BI_WEEKLY', 'WEEKLY'] })
  @IsOptional()
  @IsIn(['MONTHLY', 'BI_WEEKLY', 'WEEKLY'])
  payrollFrequency?: string;

  @ApiPropertyOptional({ description: 'Day of month payroll is processed (1-31)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  payrollProcessingDay?: number;

  // ---- Status & Geofencing ----
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Office latitude for geofencing (-90 to 90)' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  officeLatitude?: number;

  @ApiPropertyOptional({ description: 'Office longitude for geofencing (-180 to 180)' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  officeLongitude?: number;

  @ApiPropertyOptional({ description: 'Allowed radius from office in metres (minimum 1)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  officeRadiusMeters?: number;
}

export class CompanyQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
