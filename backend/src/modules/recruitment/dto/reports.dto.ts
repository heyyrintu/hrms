import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** `GET /recruitment/reports/funnel`. MANAGER additionally requires jobOpeningId (checked in the service). */
export class FunnelQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  jobOpeningId?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
