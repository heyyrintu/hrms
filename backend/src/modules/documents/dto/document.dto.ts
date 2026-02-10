import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentCategory } from '@prisma/client';

export class CreateDocumentDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ enum: DocumentCategory, default: 'OTHER' })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional({ description: 'Document date in YYYY-MM-DD format' })
  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @ApiPropertyOptional({ description: 'Expiry date in YYYY-MM-DD format' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class DocumentQueryDto {
  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;
}
