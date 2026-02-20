import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsDateString,
  IsArray,
  IsNumber,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsString()
  taskListId?: string;

  @IsOptional()
  @IsString()
  phaseId?: string;

  @IsOptional()
  parentId?: string;  // Removed @IsString() temporarily or we can use @ValidateIf

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  priority?: number;

  @IsOptional()
  @ValidateIf((o) => o.dueDate !== '' && o.dueDate !== null)
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];
}

export class MoveTaskDto {
  @IsOptional()
  @IsString()
  newTaskListId?: string;

  @IsOptional()
  @IsString()
  newPhaseId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  newOrderIndex?: number;
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
  @Min(1)
  @Max(5)
  @Type(() => Number)
  priority?: number;

  @IsOptional()
  @ValidateIf((o) => o.dueDate !== '' && o.dueDate !== null)
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];
}

export class AddAssigneeDto {
  @IsNotEmpty()
  @IsString()
  userId: string;
}

export class BulkAssignDto {
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  taskIds: string[];

  @IsNotEmpty()
  @IsString()
  userId: string;
}

/**
 * Query DTO for "My Tasks" - tasks assigned to the current user
 * Supports pagination
 */
export class MyTasksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
