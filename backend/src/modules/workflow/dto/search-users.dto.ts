import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchUsersDto {
  @ApiPropertyOptional({ description: 'Matches name or email, case-insensitive' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
