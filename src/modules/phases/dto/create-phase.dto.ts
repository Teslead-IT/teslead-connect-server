import {
    IsNotEmpty,
    IsString,
    IsOptional,
    IsDateString,
    IsIn,
    IsInt,
    Min,
    ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePhaseDto {
    @IsNotEmpty()
    @IsString()
    projectId: string;

    @IsNotEmpty()
    @IsString()
    name: string;

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
