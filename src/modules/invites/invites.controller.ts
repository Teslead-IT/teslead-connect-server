import { Controller, Post, Get, Body, Param, UseGuards, Logger } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { SendInviteDto, AcceptInviteDto, RejectInviteDto, ResendInviteDto } from './dto/invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserId } from '../../common/decorators/org.decorator';
import { NotificationService } from '../notifications/notification.service';
import { ConfigService } from '@nestjs/config';

/**
 * Invites Controller
 * Handles organization member invitation lifecycle
 * All routes require authentication (JwtAuthGuard)
 */
@Controller('invites')
@UseGuards(JwtAuthGuard)
export class InvitesController {
    private readonly logger = new Logger(InvitesController.name);

    constructor(
        private readonly invitesService: InvitesService,
        private readonly notificationService: NotificationService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * POST /invites/send/:orgId
     * Send invitation to user (organization-level with optional project assignment)
     * Only ADMIN/OWNER can send (enforced in service)
     */
    @Post('send/:orgId')
    async sendInvite(
        @UserId() userId: string,
        @Param('orgId') orgId: string,
        @Body() dto: SendInviteDto,
    ) {
        this.logger.log(`User ${userId} sending invite to ${dto.email} for org ${orgId}`);

        const result = await this.invitesService.sendInvite(userId, orgId, dto);

        // Only send invite email/notification if a token was generated (new invite)
        if (result.inviteToken) {
            // Send email with invite link
            await this.sendInviteEmail(dto.email, result.organizationName, result.inviteToken, result.projectName);

            // Send real-time notification (if user exists)
            await this.notificationService.sendInviteNotification(
                dto.email,
                orgId,
                result.organizationName,
            );
        } else if (result.status === 'EXISTING_MEMBER') {
            this.logger.log(`User ${dto.email} is already a member. Updated role/project access.`);
        }

        return {
            message: result.status === 'EXISTING_MEMBER' ? 'User updated successfully' : 'Invitation sent successfully',
            email: dto.email,
            orgRole: result.orgRole,
            id: result.id,
            projectRole: result.projectRole,
            expiresAt: result.expiresAt,
        };
    }

    /**
     * POST /invites/accept
     * Accept invitation (user must be authenticated)
     */
    @Post('accept')
    async acceptInvite(@UserId() userId: string, @Body() dto: AcceptInviteDto) {
        this.logger.log(`User ${userId} accepting invite with token ${dto.inviteToken.substring(0, 8)}...`);

        const result = await this.invitesService.acceptInvite(dto.inviteToken, userId);

        // Notify admin
        await this.notificationService.sendInviteAcceptedNotification(
            result.organization.id,
            userId,
        );

        return result;
    }

    /**
     * POST /invites/reject
     * Reject invitation
     */
    @Post('reject')
    async rejectInvite(@UserId() userId: string, @Body() dto: RejectInviteDto) {
        this.logger.log(`User ${userId} rejecting invite`);

        const result = await this.invitesService.rejectInvite(dto.inviteToken, userId);

        // Notify admin
        await this.notificationService.sendInviteRejectedNotification(
            dto.inviteToken,
            userId,
        );

        return result;
    }

    /**
     * POST /invites/resend/:orgId
     * Resend invitation (admin only)
     */
    @Post('resend/:orgId')
    async resendInvite(
        @UserId() userId: string,
        @Param('orgId') orgId: string,
        @Body() dto: ResendInviteDto,
    ) {
        this.logger.log(`User ${userId} resending invite to ${dto.email}`);

        const result = await this.invitesService.resendInvite(userId, orgId, dto.email);

        // Send email with invite link
        await this.sendInviteEmail(dto.email, result.organizationName, result.inviteToken);

        return {
            message: 'Invitation resent successfully',
            email: dto.email,
            expiresAt: result.expiresAt,
        };
    }

    /**
     * GET /invites/pending
     * Get current user's pending invitations
     */
    @Get('pending')
    async getPendingInvites(@UserId() userId: string) {
        return this.invitesService.getPendingInvites(userId);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 📧 EMAIL HELPER (Private)
    // ═══════════════════════════════════════════════════════════════════════════

    private async sendInviteEmail(to: string, orgName: string, inviteToken: string, projectName?: string) {
        try {
            const transporter = this.getEmailTransporter();
            if (transporter) {
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                const acceptUrl = `${frontendUrl}/invites/accept?token=${inviteToken}`;

                await transporter.sendMail({
                    from: this.configService.get('SMTP_FROM') || 'no-reply@teslead.com',
                    to,
                    subject: `You've been invited to join ${orgName}`,
                    html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #111827;">Join ${orgName}</h2>
              <p style="color: #4b5563;">You have been invited to join the organization <strong>${orgName}</strong> on our platform.</p>
              ${projectName ? `<p style="color: #4b5563;">You have also been invited to join the project <strong>${projectName}</strong>.</p>` : ''}
              <div style="margin: 30px 0;">
                <a href="${acceptUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Accept Invitation</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
              <p style="color: #6b7280; font-size: 14px; word-break: break-all;">${acceptUrl}</p>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">This invitation expires in 7 days.</p>
            </div>
          `,
                });
                this.logger.log(`Invite email sent to ${to}`);
            } else {
                this.logger.warn('SMTP transporter not available. Email not sent.');
            }
        } catch (error) {
            this.logger.error(`Failed to send invite email to ${to}: ${error.message}`);
        }
    }

    private getEmailTransporter() {
        const host = this.configService.get('SMTP_HOST');
        const user = this.configService.get('SMTP_USER');
        const pass = this.configService.get('SMTP_PASS');

        if (!host || !user || !pass) {
            if (process.env.NODE_ENV === 'production') {
                this.logger.warn('SMTP credentials missing! Emails will not be sent.');
            }
            return null;
        }

        const nodemailer = require('nodemailer');
        return nodemailer.createTransport({
            host,
            port: parseInt(this.configService.get('SMTP_PORT') || '587'),
            secure: false,
            auth: { user, pass },
            tls: {
                rejectUnauthorized: false,
            },
        });
    }
}
