import {
    IsOptional,
    IsString,
    IsDateString,
    IsIn,
    IsInt,
    IsArray,
    Min,
    ValidateNested,
    ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePhaseDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    ownerId?: string;

    @IsOptional()
    @ValidateIf((o) => o.startDate !== '' && o.startDate !== null)
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @ValidateIf((o) => o.endDate !== '' && o.endDate !== null)
    @IsDateString()
    endDate?: string;

    @IsOptional()
    @IsIn(['PUBLIC', 'PRIVATE'])
    access?: 'PUBLIC' | 'PRIVATE';
}

export class ReorderPhaseDto {
    @IsArray()
    @IsString({ each: true })
    orderedIds: string[];
}
