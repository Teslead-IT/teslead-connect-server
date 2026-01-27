import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgRole, MemberStatus, ProjectRole } from '@prisma/client';
import { generateInviteToken, calculateExpiryDate, isInviteExpired } from './invite.util';

/**
 * Invites Service
 * Handles organization member invitation lifecycle
 * Security: Validates permissions, tokens, expiry before every action
 */
@Injectable()
export class InvitesService {
    private readonly logger = new Logger(InvitesService.name);

    constructor(private prisma: PrismaService) { }

    /**
   * Send Invite (Organization-level with optional project assignment)
   * - Validates requester is ADMIN/OWNER
   * - Generates secure token + expiry (48hrs)
   * - Creates OrgMember with status=INVITED
   * - Optionally: Auto-assigns to project if id provided
   * 
   * Why userId nullable: User may not exist yet (pre-signup invite)
   */
    async sendInvite(requesterId: string, orgId: string, dto: { email: string; orgRole: OrgRole; id?: string; projectRole?: ProjectRole }) {
        const { email, orgRole, id, projectRole } = dto;

        this.logger.log(`Processing invite for ${email} to org ${orgId}`);

        // 1. Permission Check: Only ADMIN/OWNER can invite
        const requester = await this.prisma.orgMember.findUnique({
            where: { userId_orgId: { userId: requesterId, orgId } },
            include: { org: true },
        });

        if (!requester || (requester.role !== OrgRole.OWNER && requester.role !== OrgRole.ADMIN)) {
            throw new ForbiddenException('Only Admins or Owners can send invitations');
        }

        let projectName: string | undefined;

        // 2. If id provided, validate it exists and belongs to org
        if (id) {
            if (!projectRole) {
                throw new BadRequestException('projectRole is required when id is provided');
            }

            const project = await this.prisma.project.findFirst({
                where: { id: id, orgId },
            });

            if (!project) {
                throw new NotFoundException('Project not found or does not belong to this organization');
            }
            projectName = project.name;
        }

        // 3. Check if email already invited or member
        const existingMember = await this.prisma.orgMember.findFirst({
            where: {
                email,
                orgId,
            },
        });

        // A. Handle Existing ACTIVE Member
        if (existingMember && existingMember.status === MemberStatus.ACTIVE) {
            // Update Org Role if requested role is different (usually upgrade)
            let currentOrgRole = existingMember.role;
            if (existingMember.role !== orgRole) {
                await this.prisma.orgMember.update({
                    where: { id: existingMember.id },
                    data: { role: orgRole },
                });
                currentOrgRole = orgRole;
                this.logger.log(`Updated existing member ${email} role to ${orgRole}`);
            }

            // Add to Project if requested
            if (id && projectRole && existingMember.userId) {
                await this.prisma.projectMember.upsert({
                    where: {
                        projectId_userId: {
                            projectId: id,
                            userId: existingMember.userId,
                        }
                    },
                    update: {
                        role: projectRole,
                        isActive: true,
                    },
                    create: {
                        projectId: id,
                        userId: existingMember.userId,
                        role: projectRole,
                        isActive: true,
                    },
                });
                this.logger.log(`Added existing member ${email} to project ${id}`);
            }

            // Return special status for controller to handle
            return {
                status: 'EXISTING_MEMBER',
                email,
                organizationId: orgId,
                organizationName: requester.org.name,
                orgRole: currentOrgRole,
                id,
                projectRole,
                projectName,
                inviteToken: undefined,
                expiresAt: undefined,
            };
        }

        // B. Handle Already INVITED Member
        if (existingMember && existingMember.status === MemberStatus.INVITED) {
            throw new ConflictException('Invitation already sent to this email');
        }

        // 4. Prepare for Invite (Find user, Generate tokens) creates/updates require this
        const user = await this.prisma.user.findUnique({ where: { email } });
        const inviteToken = generateInviteToken();
        const expiresAt = calculateExpiryDate(48); // 48 hours

        // 5. Execute Invite (Update if Rejected, Create if New)
        if (existingMember && existingMember.status === MemberStatus.REJECTED) {
            this.logger.log(`Re-inviting previously rejected user ${email}`);

            await this.prisma.orgMember.update({
                where: { id: existingMember.id },
                data: {
                    role: orgRole,
                    status: MemberStatus.INVITED,
                    inviteToken,
                    expiresAt,
                    inviteProjectId: id,
                    inviteProjectRole: projectRole,
                },
            });
        } else {
            await this.prisma.orgMember.create({
                data: {
                    userId: user?.id,
                    email,
                    orgId,
                    role: orgRole,
                    status: MemberStatus.INVITED,
                    inviteToken,
                    expiresAt,
                    isActive: false,
                    inviteProjectId: id,
                    inviteProjectRole: projectRole,
                },
            });
        }

        this.logger.log(`Invite sent: ${email} → ${requester.org.name} (OrgRole: ${orgRole}${id ? `, Project: ${id}, ProjectRole: ${projectRole}` : ''})`);

        return {
            status: 'INVITED',
            inviteToken,
            email,
            organizationId: orgId,
            organizationName: requester.org.name,
            orgRole,
            id,
            projectRole,
            projectName,
            expiresAt,
            // Note: Project assignment happens on acceptance (stored in token metadata)
        };
    }

    /**
     * Accept Invite
     * - Validates token exists, not expired, status=INVITED
     * - Updates status → ACTIVE, clears token
     * - Handles pre-signup scenario (userId linking)
     * 
     * Security: Single-use token (cleared after use)
     */
    async acceptInvite(inviteToken: string, userId: string) {
        // 1. Find invitation by token
        const invitation = await this.prisma.orgMember.findUnique({
            where: { inviteToken },
            include: { org: true },
        });

        if (!invitation) {
            throw new NotFoundException('Invalid invitation token');
        }

        // 2. Validate status
        if (invitation.status !== MemberStatus.INVITED) {
            throw new BadRequestException('This invitation has already been processed');
        }

        // 3. Validate expiry
        if (isInviteExpired(invitation.expiresAt)) {
            throw new BadRequestException('This invitation has expired');
        }

        // 4. Validate user email match (security: only invited email can accept)
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.email !== invitation.email) {
            throw new ForbiddenException('This invitation is not for your email address');
        }

        // 5. Accept: Update status, link userId, clear token
        // Use transaction to ensure both Org and Project membership are updated atomically
        const accepted = await this.prisma.$transaction(async (tx) => {
            // A. Update OrgMember status
            const orgMember = await tx.orgMember.update({
                where: { id: invitation.id },
                data: {
                    userId, // Link user (for pre-signup invites)
                    status: MemberStatus.ACTIVE,
                    isActive: true,
                    inviteToken: null, // Single-use: destroy token
                    expiresAt: null,
                },
                include: { org: true },
            });

            // B. Add to Project (if this was a project invite)
            if (invitation.inviteProjectId && invitation.inviteProjectRole) {
                // Upsert to handle potential re-invites or existing memberships safely
                await tx.projectMember.upsert({
                    where: {
                        projectId_userId: {
                            projectId: invitation.inviteProjectId,
                            userId,
                        }
                    },
                    update: {
                        role: invitation.inviteProjectRole,
                        isActive: true,
                    },
                    create: {
                        projectId: invitation.inviteProjectId,
                        userId,
                        role: invitation.inviteProjectRole,
                        isActive: true,
                    },
                });

                this.logger.log(`Project access granted: ${user.email} → Project ${invitation.inviteProjectId} as ${invitation.inviteProjectRole}`);
            }

            return orgMember;
        });

        this.logger.log(`Invite accepted: ${user.email} → ${accepted.org.name}`);

        return {
            message: 'Invitation accepted successfully',
            organization: {
                id: accepted.org.id,
                name: accepted.org.name,
                role: accepted.role,
            },
        };
    }

    /**
     * Reject Invite
     * - Updates status → REJECTED
     * - Clears token (no reuse)
     */
    async rejectInvite(inviteToken: string, userId: string) {
        // 1. Find + validate
        const invitation = await this.prisma.orgMember.findUnique({
            where: { inviteToken },
            include: { org: true },
        });

        if (!invitation) {
            throw new NotFoundException('Invalid invitation token');
        }

        if (invitation.status !== MemberStatus.INVITED) {
            throw new BadRequestException('This invitation has already been processed');
        }

        // 2. Validate user email match
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.email !== invitation.email) {
            throw new ForbiddenException('This invitation is not for your email address');
        }

        // 3. Reject
        const rejected = await this.prisma.orgMember.update({
            where: { id: invitation.id },
            data: {
                status: MemberStatus.REJECTED,
                inviteToken: null, // Clear token
                expiresAt: null,
            },
            include: { org: true },
        });

        this.logger.log(`Invite rejected: ${user.email} → ${rejected.org.name}`);

        return {
            message: 'Invitation rejected',
            organizationName: rejected.org.name,
        };
    }

    /**
     * Resend Invite
     * - Admin can resend expired/rejected invites
     * - Generates NEW token + expiry
     */
    async resendInvite(requesterId: string, orgId: string, email: string) {
        // 1. Permission check
        const requester = await this.prisma.orgMember.findUnique({
            where: { userId_orgId: { userId: requesterId, orgId } },
            include: { org: true },
        });

        if (!requester || (requester.role !== OrgRole.OWNER && requester.role !== OrgRole.ADMIN)) {
            throw new ForbiddenException('Only Admins or Owners can resend invitations');
        }

        // 2. Find existing invitation
        const existing = await this.prisma.orgMember.findFirst({
            where: { email, orgId },
        });

        if (!existing) {
            throw new NotFoundException('No invitation found for this email');
        }

        if (existing.status === MemberStatus.ACTIVE) {
            throw new ConflictException('User is already an active member');
        }

        // 3. Generate new token + expiry
        const inviteToken = generateInviteToken();
        const expiresAt = calculateExpiryDate(48);

        // 4. Update invitation
        const resent = await this.prisma.orgMember.update({
            where: { id: existing.id },
            data: {
                inviteToken,
                expiresAt,
                status: MemberStatus.INVITED, // Reset to INVITED
            },
            include: { org: true },
        });

        this.logger.log(`Invite resent: ${email} → ${resent.org.name}`);

        return {
            inviteToken,
            email,
            organizationName: resent.org.name,
            role: resent.role,
            expiresAt,
        };
    }

    /**
     * Get user's pending invites
     * Used for displaying invitations dashboard
     */
    async getPendingInvites(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        return this.prisma.orgMember.findMany({
            where: {
                email: user.email,
                status: MemberStatus.INVITED,
            },
            include: {
                org: { select: { id: true, name: true, slug: true } },
            },
            orderBy: { joinedAt: 'desc' },
        });
    }

    /**
     * Search Users for Auto-suggestion
     * CASE A: projectId provided -> Search members of that project (filtered by query)
     * CASE B: No projectId -> Search all users (filtered by query)
     */
    async searchUsers(dto: { query?: string; projectId?: string; page?: number; limit?: number }) {
        const { query, projectId, page = 1, limit = 5 } = dto;
        const skip = (page - 1) * limit;

        // CASE 1: Project Scope
        if (projectId) {
            const whereClause: any = {
                projectId,
                isActive: true,
            };

            if (query) {
                whereClause.user = {
                    email: { contains: query, mode: 'insensitive' }
                };
            }

            const [total, members] = await this.prisma.$transaction([
                this.prisma.projectMember.count({ where: whereClause }),
                this.prisma.projectMember.findMany({
                    where: whereClause,
                    select: {
                        user: {
                            select: { id: true, email: true, name: true, avatarUrl: true }
                        }
                    },
                    skip,
                    take: limit,
                }),
            ]);

            return {
                data: members.map(m => m.user),
                meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
            };
        }

        // CASE 2: Global Scope
        const whereClause: any = {};
        if (query) {
            whereClause.email = { contains: query, mode: 'insensitive' };
        }

        const [total, users] = await this.prisma.$transaction([
            this.prisma.user.count({ where: whereClause }),
            this.prisma.user.findMany({
                where: whereClause,
                select: { id: true, email: true, name: true, avatarUrl: true },
                skip,
                take: limit,
            }),
        ]);

        return {
            data: users,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
        };
    }
}
