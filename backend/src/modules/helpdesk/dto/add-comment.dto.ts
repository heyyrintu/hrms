import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddCommentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Internal notes are visible to HR and the assignee only, never to the employee who raised the ticket.',
  })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
