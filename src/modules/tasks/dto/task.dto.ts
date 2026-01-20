import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsDateString,
  IsArray,
} from 'class-validator';

export class CreateTaskDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  parentId?: string;  // Removed @IsString() temporarily or we can use @ValidateIf

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];
}


export class UpdateTaskStatusDto {
  @IsNotEmpty()
  @IsString()
  statusId: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];
}
