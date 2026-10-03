import { IsInt, IsOptional, IsString, IsUUID, Max, Min, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalibrateDto {
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5, description: '1-5, or null to revert the override' })
  @ValidateIf((o: CalibrateDto) => o.rating !== null)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number | null;

  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;
}

export class CalibrationQueryDto {
  @ApiProperty()
  @IsUUID()
  cycleId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Reviewer (manager) employee id' })
  @IsOptional()
  @IsUUID()
  managerId?: string;
}

export class NineBoxQueryDto {
  @ApiProperty()
  @IsUUID()
  cycleId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
