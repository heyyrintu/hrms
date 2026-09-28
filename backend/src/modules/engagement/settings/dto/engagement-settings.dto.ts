import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Partial update: only the fields sent are changed. */
export class UpdateEngagementSettingsDto {
  @ApiPropertyOptional({
    description: 'Turn recognition points on. When off, recognitions carry no points.',
  })
  @IsOptional()
  @IsBoolean()
  pointsEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Points each employee may give per IST calendar month.',
    minimum: 0,
    maximum: 100000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  monthlyPointsAllowance?: number;

  @ApiPropertyOptional({ description: 'Post birthdays to the feed.' })
  @IsOptional()
  @IsBoolean()
  showBirthdays?: boolean;

  @ApiPropertyOptional({ description: 'Post work anniversaries to the feed.' })
  @IsOptional()
  @IsBoolean()
  showAnniversaries?: boolean;
}
