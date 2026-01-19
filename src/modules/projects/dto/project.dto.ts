import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsOptional, MinLength, IsDateString, IsEnum, IsArray, ValidateNested, IsHexColor } from 'class-validator';

export enum ProjectAccess {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}


export enum ProjectStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class CreateTagDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  @IsHexColor()
  color?: string;
}

export class CreateProjectDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(ProjectAccess)
  access?: ProjectAccess;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTagDto)
  tags?: CreateTagDto[];
}
