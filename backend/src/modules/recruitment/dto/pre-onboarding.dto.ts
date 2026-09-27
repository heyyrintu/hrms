import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PreOnboardingDocumentDefinitionDto } from './settings.dto';

/** `POST /recruitment/pre-onboarding` (HR). */
export class CreatePreOnboardingDto {
  @IsUUID()
  employeeId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  offerId?: string;

  @ApiPropertyOptional({ type: [PreOnboardingDocumentDefinitionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreOnboardingDocumentDefinitionDto)
  requiredDocuments?: PreOnboardingDocumentDefinitionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}

/**
 * `PUT /public/pre-onboarding/:token/details` — the ONLY fields the public
 * portal may write. Deliberately excludes bank account, PAN, Aadhaar and UAN
 * (wave D3 scope; those stay HR-only via the authenticated employee endpoints).
 * Every field optional and nullable (a candidate clearing a field sends null);
 * `forbidNonWhitelisted` on the global pipe rejects any other key, including
 * bank/tax fields, before this DTO's own validators run.
 */
export class PreOnboardingDetailsDto {
  /**
   * A plain YYYY-MM-DD calendar date only: the service appends
   * `T00:00:00.000Z`, so a full ISO datetime would become an Invalid Date
   * (a 500) rather than a 400. The strict ISO check rejects 1995-02-30.
   */
  @ApiPropertyOptional({ nullable: true, example: '1995-06-15' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be a date in YYYY-MM-DD format' })
  @IsDateString({ strict: true }, { message: 'dateOfBirth must be a valid calendar date' })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(20)
  gender?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(30)
  maritalStatus?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(10)
  bloodGroup?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(150)
  fatherName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsEmail()
  @MaxLength(255)
  personalEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(30)
  mobileNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(255)
  currentAddress?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(100)
  currentCity?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(100)
  currentState?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(20)
  currentZipCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(100)
  currentCountry?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(255)
  permanentAddress?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(100)
  permanentCity?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(100)
  permanentState?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(20)
  permanentZipCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(100)
  permanentCountry?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(150)
  emergencyContactName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(30)
  emergencyContactNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(50)
  emergencyContactRelation?: string | null;
}
