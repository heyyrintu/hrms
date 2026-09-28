import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OneOnOneStatus } from '@prisma/client';

export class CreateOneOnOneDto {
  @ApiProperty({ description: 'The other participant: your manager or a direct report' })
  @IsString()
  counterpartId: string;

  @ApiProperty({ description: 'When the one-on-one is scheduled, as an ISO-8601 timestamp' })
  @IsISO8601()
  scheduledAt: string;

  @ApiPropertyOptional({ description: 'What to discuss' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  agenda?: string;
}

export class UpdateOneOnOneDto {
  @ApiPropertyOptional({ description: 'Reschedule the meeting' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional({ description: 'What to discuss' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  agenda?: string;

  @ApiPropertyOptional({ description: 'Notes both participants can see' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sharedNotes?: string;

  @ApiPropertyOptional({ enum: OneOnOneStatus })
  @IsOptional()
  @IsEnum(OneOnOneStatus)
  status?: OneOnOneStatus;
}

export class ListOneOnOnesDto {
  @ApiPropertyOptional({ description: 'Only meetings with this counterpart' })
  @IsOptional()
  @IsString()
  counterpartId?: string;

  @ApiPropertyOptional({ enum: OneOnOneStatus })
  @IsOptional()
  @IsEnum(OneOnOneStatus)
  status?: OneOnOneStatus;
}

export class OpenItemsQueryDto {
  @ApiProperty({ description: 'The counterpart to find shared open items with' })
  @IsString()
  counterpartId: string;
}

export class AddActionItemDto {
  @ApiProperty({ description: 'What needs to be done' })
  @IsString()
  @MaxLength(500)
  text: string;

  @ApiProperty({ description: 'Must be one of the two participants' })
  @IsString()
  assigneeId: string;

  @ApiPropertyOptional({ description: 'Calendar date the item is due, as an ISO-8601 date' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}

export class UpdateActionItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDone?: boolean;

  @ApiPropertyOptional({ description: 'Calendar date the item is due, as an ISO-8601 date; null clears it' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;
}

export class UpsertPrivateNoteDto {
  @ApiProperty({ description: 'Only the author can ever read this. Empty content deletes the note.' })
  @IsString()
  @MaxLength(20000)
  content: string;
}
