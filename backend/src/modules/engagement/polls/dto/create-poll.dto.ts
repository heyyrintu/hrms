import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePollDto {
  @ApiProperty({ description: 'The question being polled', minLength: 1, maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  question: string;

  @ApiProperty({
    type: [String],
    description: '2-10 distinct, non-empty options (compared after trimming)',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  options: string[];

  @ApiPropertyOptional({ description: 'When the poll closes; open-ended when omitted' })
  @IsOptional()
  @IsISO8601()
  closesAt?: string;
}
