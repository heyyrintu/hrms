import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookLogStatus } from '@prisma/client';
import { WEBHOOK_EVENTS } from '../webhook-events';

export class CreateWebhookDto {
  @ApiProperty({
    description: 'Absolute http:// or https:// URL the payload is POSTed to',
    example: 'https://example.com/hooks/hrms',
  })
  @IsString()
  url: string;

  @ApiProperty({
    description: 'Event names to subscribe to',
    isArray: true,
    enum: WEBHOOK_EVENTS,
    example: ['leave.approved'],
  })
  @IsArray()
  @IsString({ each: true })
  events: string[];

  @ApiPropertyOptional({
    description:
      'Shared secret. When set, each delivery carries an X-HRMS-Signature header.',
  })
  @IsOptional()
  @IsString()
  secret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ isArray: true, enum: WEBHOOK_EVENTS })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({
    description:
      'Replaces the stored secret. Send an empty string to remove signing.',
  })
  @IsOptional()
  @IsString()
  secret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class WebhookLogQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: WebhookLogStatus })
  @IsOptional()
  @IsEnum(WebhookLogStatus)
  status?: WebhookLogStatus;
}
