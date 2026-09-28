import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FeedReactionKind } from '@prisma/client';

export class ReactToFeedItemDto {
  @ApiProperty({ enum: FeedReactionKind })
  @IsEnum(FeedReactionKind)
  kind: FeedReactionKind;
}
