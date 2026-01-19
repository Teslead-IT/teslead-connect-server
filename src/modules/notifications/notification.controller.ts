import { Controller, Get, Put, Param, UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserId } from '../../common/decorators/org.decorator';

/**
 * Notifications Controller
 * HTTP endpoints for notification management
 * Real-time delivery handled by NotificationGateway
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    /**
     * GET /notifications/unread
     * Get current user's unread notifications
     */
    @Get('unread')
    async getUnreadNotifications(@UserId() userId: string) {
        return this.notificationService.getUnreadNotifications(userId);
    }

    /**
     * PUT /notifications/:id/read
     * Mark notification as read
     */
    @Put(':id/read')
    async markAsRead(@UserId() userId: string, @Param('id') notificationId: string) {
        return this.notificationService.markAsRead(notificationId, userId);
    }
}
