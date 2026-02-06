import { Controller, Get, Post, Param, ParseIntPipe, Request, Patch, Delete, Query } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Get()
  async getMyNotifications(
    @Request() req,
    @Query('limit') limit: string = '20',
  ) {
    const userId = req.user.id;
    const notifications = await this.notificationService.getUserNotifications(
      userId,
      parseInt(limit),
    );
    const unreadCount = await this.notificationService.getUnreadCount(userId);

    return {
      data: notifications,
      unreadCount,
      total: notifications.length,
    };
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req) {
    const userId = req.user.id;
    const count = await this.notificationService.getUnreadCount(userId);
    return { unreadCount: count };
  }

  @Patch(':id/read')
  async markAsRead(@Param('id', ParseIntPipe) id: number) {
    const notification = await this.notificationService.markAsRead(id);
    return {
      message: 'Notification marked as read',
      data: notification,
    };
  }

  @Post('mark-all-read')
  async markAllAsRead(@Request() req) {
    const userId = req.user.id;
    await this.notificationService.markAllAsRead(userId);
    return { message: 'All notifications marked as read' };
  }

  @Delete(':id')
  async deleteNotification(@Param('id', ParseIntPipe) id: number) {
    await this.notificationService.deleteNotification(id);
    return { message: 'Notification deleted' };
  }

  @Delete()
  async deleteAllNotifications(@Request() req) {
    const userId = req.user.id;
    await this.notificationService.deleteAllUserNotifications(userId);
    return { message: 'All notifications deleted' };
  }
}
