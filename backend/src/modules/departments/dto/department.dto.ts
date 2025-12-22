import { IsString, IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
