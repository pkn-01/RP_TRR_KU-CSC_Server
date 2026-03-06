import { Controller, Get, Post, Param, ParseIntPipe, Request, Patch, Delete, Query } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  // ดึงรายการแจ้งเตือนทั้งหมดของฉัน | Get all my notifications
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

  // ดึงจำนวนการแจ้งเตือนที่ยังไม่ได้อ่าน | Get unread notification count
  @Get('unread-count')
  async getUnreadCount(@Request() req) {
    const userId = req.user.id;
    const count = await this.notificationService.getUnreadCount(userId);
    return { unreadCount: count };
  }

  // ทำเครื่องหมายแจ้งเตือนว่าอ่านแล้ว | Mark notification as read
  @Patch(':id/read')
  async markAsRead(@Param('id', ParseIntPipe) id: number) {
    const notification = await this.notificationService.markAsRead(id);
    return {
      message: 'Notification marked as read',
      data: notification,
    };
  }

  // ทำเครื่องหมายแจ้งเตือนทั้งหมดว่าอ่านแล้ว | Mark all notifications as read
  @Post('mark-all-read')
  async markAllAsRead(@Request() req) {
    const userId = req.user.id;
    await this.notificationService.markAllAsRead(userId);
    return { message: 'All notifications marked as read' };
  }

  // ลบการแจ้งเตือนตาม ID | Delete notification by ID
  @Delete(':id')
  async deleteNotification(@Param('id', ParseIntPipe) id: number) {
    await this.notificationService.deleteNotification(id);
    return { message: 'Notification deleted' };
  }

  // ลบการแจ้งเตือนทั้งหมด | Delete all notifications
  @Delete()
  async deleteAllNotifications(@Request() req) {
    const userId = req.user.id;
    await this.notificationService.deleteAllUserNotifications(userId);
    return { message: 'All notifications deleted' };
  }
}
