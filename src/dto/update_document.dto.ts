import {
  IsString,
  IsUUID,
  IsInt,
  IsArray,
  IsOptional,
  ValidateNested,
  Min,
  IsNotEmpty,
} from 'class-validator';

import { Type } from 'class-transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class SubtitleDto {
  @ApiProperty({
    description: 'Unique identifier of the subtitle',
    example: 'bcae7d8e-38dd-4e17-89e7-8e08f4d69abc',
  })
  @IsUUID()
  id!: string;

  @ApiProperty({
    description: 'Subtitle title',
    example: 'Introduction',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Subtitle content',
    example: 'Updated subtitle content',
  })
  @IsString()
  content!: string;

  @ApiProperty({
    description: 'Version of the subtitle the client edited from',
    example: 2,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  base_version!: number;

  @ApiPropertyOptional({
    description: 'Original subtitle title before the client edit',
    example: 'Introduction',
  })
  @IsOptional()
  @IsString()
  base_title?: string;

  @ApiPropertyOptional({
    description: 'Original subtitle content before the client edit',
    example: 'Original content',
  })
  @IsOptional()
  @IsString()
  base_content?: string;
}

export class UpdateDocumentDto {
  @IsString()
  @IsNotEmpty()
  base_title!: string;
  @ApiProperty({
    description: 'Updated notebook title',
    example: 'My Collaborative Notebook',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Subtitles included in the merge request',
    type: () => SubtitleDto,
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubtitleDto)
  subtitles!: SubtitleDto[];

  @ApiProperty({
    description: 'Notebook version the client is updating from',
    example: 3,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({
    description: 'UUID of the notebook being updated',
    example: '7e1c8d65-0c51-4b3f-a7b8-123456789abc',
  })
  @IsUUID()
  uuid!: string;
}