import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { EmploymentType, JobOfferStatus } from '@prisma/client';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class CreateOfferDto {
  @ApiProperty({ description: 'An active OFFER_LETTER letter template' })
  @IsUUID()
  templateId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  designationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ description: 'Employee id' })
  @IsOptional()
  @IsUUID()
  reportingManagerId?: string | null;

  @ApiPropertyOptional({ enum: EmploymentType, default: EmploymentType.PERMANENT })
  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  annualCtc: number;

  @ApiPropertyOptional({ description: 'With salaryStructureId: the EmployeeSalary base pay on conversion' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyBasePay?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  salaryStructureId?: string | null;

  @ApiProperty({ example: '2026-04-01' })
  @Matches(YMD, { message: 'joiningDate must be YYYY-MM-DD' })
  joiningDate: string;

  @ApiPropertyOptional({ description: 'ISO date-time; default is sending time + offerExpiryDays' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class UpdateOfferDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  designationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reportingManagerId?: string | null;

  @ApiPropertyOptional({ enum: EmploymentType })
  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  annualCtc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyBasePay?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  salaryStructureId?: string | null;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @Matches(YMD, { message: 'joiningDate must be YYYY-MM-DD' })
  joiningDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class ListOffersDto {
  @ApiPropertyOptional({ enum: JobOfferStatus })
  @IsOptional()
  @IsEnum(JobOfferStatus)
  status?: JobOfferStatus;
}

export class ConvertOfferDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employeeCode: string;

  @ApiPropertyOptional({ description: 'Also create a login for the new employee' })
  @IsOptional()
  @IsBoolean()
  createUser?: boolean;

  @ApiPropertyOptional({ description: "Defaults to the candidate's email" })
  @ValidateIf((o) => o.createUser === true && o.userEmail !== undefined)
  @IsEmail()
  userEmail?: string;

  @ApiPropertyOptional({ minLength: 8 })
  @ValidateIf((o) => o.createUser === true)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  userPassword?: string;

  @ApiPropertyOptional({ description: 'Start an onboarding process from this template' })
  @IsOptional()
  @IsUUID()
  onboardingTemplateId?: string | null;
}

/** Body of POST /public/offers/:token/accept */
export class AcceptOfferDto {
  @ApiProperty({ maxLength: 200, description: "The candidate's full name, typed" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  acceptedName: string;
}

/** Body of POST /public/offers/:token/decline */
export class DeclineOfferDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}
