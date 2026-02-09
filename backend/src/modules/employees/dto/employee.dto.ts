import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsUUID,
  Min,
  IsBoolean,
  MinLength,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { EmploymentType, PayType, EmployeeStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateEmployeeDto {
  @IsString()
  employeeCode: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  salutation?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @Type(() => Date)
  dateOfBirth?: Date | string;

  @IsOptional()
  @IsString()
  fatherName?: string;

  @IsOptional()
  @IsString()
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsEmail()
  workEmail?: string;

  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsOptional()
  @IsString()
  currentAddress?: string;

  @IsOptional()
  @IsString()
  currentCity?: string;

  @IsOptional()
  @IsString()
  currentState?: string;

  @IsOptional()
  @IsString()
  currentZipCode?: string;

  @IsOptional()
  @IsString()
  currentCountry?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  permanentCity?: string;

  @IsOptional()
  @IsString()
  permanentState?: string;

  @IsOptional()
  @IsString()
  permanentZipCode?: string;

  @IsOptional()
  @IsString()
  permanentCountry?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactNumber?: string;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlySalary?: number;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsEnum(PayType)
  payType?: PayType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otMultiplier?: number;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsNotEmpty()
  @Type(() => Date)
  joinDate: Date | string;

  @IsOptional()
  @Type(() => Date)
  exitDate?: Date | string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  // User account creation fields
  @IsOptional()
  @IsBoolean()
  createUser?: boolean;

  @ValidateIf(o => o.createUser === true)
  @IsEmail()
  userEmail?: string;

  @ValidateIf(o => o.createUser === true)
  @IsString()
  @MinLength(6)
  userPassword?: string;

  @ValidateIf(o => o.createUser === true)
  @IsOptional()
  @IsEnum(UserRole)
  userRole?: UserRole;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  salutation?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @Type(() => Date)
  dateOfBirth?: Date | string;

  @IsOptional()
  @IsString()
  fatherName?: string;

  @IsOptional()
  @IsString()
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsEmail()
  workEmail?: string;

  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsOptional()
  @IsString()
  currentAddress?: string;

  @IsOptional()
  @IsString()
  currentCity?: string;

  @IsOptional()
  @IsString()
  currentState?: string;

  @IsOptional()
  @IsString()
  currentZipCode?: string;

  @IsOptional()
  @IsString()
  currentCountry?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  permanentCity?: string;

  @IsOptional()
  @IsString()
  permanentState?: string;

  @IsOptional()
  @IsString()
  permanentZipCode?: string;

  @IsOptional()
  @IsString()
  permanentCountry?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactNumber?: string;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlySalary?: number;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsEnum(PayType)
  payType?: PayType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  otMultiplier?: number;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsDateString()
  exitDate?: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;
}

export class EmployeeQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}
