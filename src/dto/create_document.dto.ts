
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

export class SubtitleDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsDateString()
  created_at?: string;

  @IsOptional()
  @IsDateString()
  updated_at?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
   
  
  @IsInt()
  @Min(1)
  base_version : number;
}

export class CreateDocumentDto {
  @IsOptional()
  @IsUUID()
  uuid?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubtitleDto)
  subtitles!: SubtitleDto[];

  @IsOptional()
  @IsString()
  deviceId?: string;
}
