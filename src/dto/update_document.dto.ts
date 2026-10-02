import {
  IsString,
  IsUUID,
  IsInt,
  IsArray,
  IsOptional,
  ValidateNested,
  Min,
  IsDateString,
} from 'class-validator';

import { Type } from 'class-transformer';

class SubtitleDto {
  @IsUUID()
  id: string;

  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsDateString()
  created_at: string;

  @IsOptional()
  @IsDateString()
  updated_at?: string;

  @IsInt()
  @Min(1)
  version: number;
}

export class UpdateDocumentDto {
  @IsString()
  title: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubtitleDto)
  subtitles: SubtitleDto[];

  @IsInt()
  @Min(1)
  version: number;

  @IsUUID()
  uuid: string;
}