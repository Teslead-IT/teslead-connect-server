import { IsEmail, IsEnum, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';
import { OrgRole, ProjectRole } from '@prisma/client';

/**
 * Organization-level invite (with optional project assignment)
 * - orgRole: Required - Organization-level role
 * - projectId: Optional - Auto-assign to this project
 * - projectRole: Required if projectId provided
 */
export class SendInviteDto {
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @IsEnum(OrgRole)
    orgRole: OrgRole;

    @IsOptional()
    id?: string;

    @ValidateIf((o) => o.id !== undefined && o.id !== null)
    @IsNotEmpty()
    @IsEnum(ProjectRole)
    projectRole?: ProjectRole;
}

/**
 * Project-level invite
 * - Automatically adds to org as MEMBER if not already
 * - Adds to project with specified ProjectRole
 */
export class SendProjectInviteDto {
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @IsEnum(ProjectRole)
    role: ProjectRole;
}

export class AcceptInviteDto {
    @IsNotEmpty()
    inviteToken: string;
}

export class RejectInviteDto {
    @IsNotEmpty()
    inviteToken: string;
}

export class ResendInviteDto {
    @IsNotEmpty()
    @IsEmail()
    email: string;
}
