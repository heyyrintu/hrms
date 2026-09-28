import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class ListSecurityUsersQueryDto {
  @ApiPropertyOptional({ description: 'Matches email or employee name, case-insensitively' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, description: 'Capped at 100 by the service' })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class SetUserRolesDto {
  @ApiProperty({ type: [String], description: 'Custom role ids to replace the current set with' })
  @IsArray()
  @IsUUID('4', { each: true })
  customRoleIds: string[];
}
