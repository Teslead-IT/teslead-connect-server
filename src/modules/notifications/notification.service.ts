import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { NotificationGateway } from './notification.gateway';

/**
 * Notification Service
 * Handles database persistence + real-time WebSocket delivery
 * Security: Notifications delivered only to target userId
 */
@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);

    constructor(
        private prisma: PrismaService,
        private notificationGateway: NotificationGateway,
    ) { }

    /**
     * Send invite received notification
     * Triggered when: Admin sends invite
     * Target: Invited user (if registered)
     */
    async sendInviteNotification(email: string, organizationId: string, organizationName: string) {
        // Find user by email (may not exist if pre-signup invite)
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user) {
            this.logger.log(`Invite sent to ${email}, but user not registered yet. Skipping notification.`);
            return null;
        }

        // Create notification in DB
        const notification = await this.prisma.notification.create({
            data: {
                userId: user.id,
                type: NotificationType.INVITE_RECEIVED,
                message: `You've been invited to join ${organizationName}`,
                organizationId,
            },
        });

        // Send real-time via WebSocket
        this.notificationGateway.sendToUser(user.id, {
            id: notification.id,
            type: notification.type,
            message: notification.message,
            organizationId: notification.organizationId,
            createdAt: notification.createdAt,
        });

        this.logger.log(`Notification sent: INVITE_RECEIVED → ${user.email}`);
        return notification;
    }

    /**
     * Send invite accepted notification
     * Triggered when: User accepts invite
     * Target: Organization admins
     */
    async sendInviteAcceptedNotification(organizationId: string, acceptedUserId: string) {
        const acceptedUser = await this.prisma.user.findUnique({
            where: { id: acceptedUserId },
        });

        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!acceptedUser || !org) return;

        // Find all admins/owners of the organization
        const admins = await this.prisma.orgMember.findMany({
            where: {
                orgId: organizationId,
                role: { in: ['OWNER', 'ADMIN'] },
                isActive: true,
            },
            select: { userId: true },
        });

        // Send notification to each admin
        for (const admin of admins) {
            if (!admin.userId) continue;

            const notification = await this.prisma.notification.create({
                data: {
                    userId: admin.userId,
                    type: NotificationType.INVITE_ACCEPTED,
                    message: `${acceptedUser.email} accepted your invitation to ${org.name}`,
                    organizationId,
                },
            });

            this.notificationGateway.sendToUser(admin.userId, {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                organizationId: notification.organizationId,
                createdAt: notification.createdAt,
            });
        }

        this.logger.log(`Notification sent: INVITE_ACCEPTED → ${admins.length} admins`);
    }

    /**
     * Send invite rejected notification
     * Triggered when: User rejects invite
     * Target: Organization admins
     */
    async sendInviteRejectedNotification(inviteToken: string, rejectedUserId: string) {
        // Find the invitation to get org context
        const invitation = await this.prisma.orgMember.findUnique({
            where: { inviteToken },
            include: { org: true },
        });

        if (!invitation) return;

        const rejectedUser = await this.prisma.user.findUnique({
            where: { id: rejectedUserId },
        });

        if (!rejectedUser) return;

        // Find admins
        const admins = await this.prisma.orgMember.findMany({
            where: {
                orgId: invitation.orgId,
                role: { in: ['OWNER', 'ADMIN'] },
                isActive: true,
            },
            select: { userId: true },
        });

        // Notify admins
        for (const admin of admins) {
            if (!admin.userId) continue;

            const notification = await this.prisma.notification.create({
                data: {
                    userId: admin.userId,
                    type: NotificationType.INVITE_REJECTED,
                    message: `${rejectedUser.email} declined your invitation to ${invitation.org.name}`,
                    organizationId: invitation.orgId,
                },
            });

            this.notificationGateway.sendToUser(admin.userId, {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                organizationId: notification.organizationId,
                createdAt: notification.createdAt,
            });
        }

        this.logger.log(`Notification sent: INVITE_REJECTED → ${admins.length} admins`);
    }

    /**
     * Mark notification as read
     */
    async markAsRead(notificationId: string, userId: string) {
        const notification = await this.prisma.notification.findFirst({
            where: { id: notificationId, userId },
        });

        if (!notification) return null;

        return this.prisma.notification.update({
            where: { id: notificationId },
            data: { readAt: new Date() },
        });
    }

    /**
     * Get user's unread notifications
     */
    async getUnreadNotifications(userId: string) {
        return this.prisma.notification.findMany({
            where: {
                userId,
                readAt: null,
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
    }
}
