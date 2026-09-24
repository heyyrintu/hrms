import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListDelegationsDto {
  @ApiPropertyOptional({ description: 'HR_ADMIN / SUPER_ADMIN only: list every delegation in the tenant' })
  @IsOptional()
  // Read the raw query value: implicit conversion would turn "false" into true.
  @Transform(({ obj }) => obj?.all === true || obj?.all === 'true')
  @IsBoolean()
  all?: boolean;
}
