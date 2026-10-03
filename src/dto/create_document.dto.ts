import {
  IsString,
  IsUUID,
  IsInt,
  IsArray,
  IsOptional,
  ValidateNested,
  Min,
  IsDateString,
  IsNotEmpty,
} from 'class-validator';

import { Type } from 'class-transformer';

import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class CreateSubtitleDto {
  @ApiProperty({
    description: 'Subtitle title',
    example: 'Introduction',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Subtitle content',
    example: 'Original content',
  })
  @IsString()
  content!: string;

  @ApiPropertyOptional({
    description: 'Subtitle creation timestamp',
    example: '2026-10-03T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  created_at?: string;

  @ApiPropertyOptional({
    description: 'Subtitle last update timestamp',
    example: '2026-10-03T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  updated_at?: string;

  @ApiPropertyOptional({
    description: 'Initial subtitle version',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class CreateDocumentDto {
  @ApiProperty({
    description: 'Notebook title',
    example: 'My Collaborative Notebook',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Subtitles belonging to the notebook',
    type: () => CreateSubtitleDto,
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSubtitleDto)
  subtitles!: CreateSubtitleDto[];

  @ApiPropertyOptional({
    description: 'Identifier of the device creating the document',
    example: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}