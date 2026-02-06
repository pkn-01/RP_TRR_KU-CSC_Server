import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateNotificationDto {
  userId: number;
  type: string; // NotificationType
  title: string;
  message: string;
  ticketId?: number;
  actionUrl?: string;
}

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  async createNotification(data: CreateNotificationDto) {
    return await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type as any,
        title: data.title,
        message: data.message,
        ticketId: data.ticketId,
        actionUrl: data.actionUrl,
      },
    });
  }

  async getUserNotifications(userId: number, limit: number = 20) {
    return await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getUnreadCount(userId: number) {
    return await this.prisma.notification.count({
      where: {
        userId,
        status: 'UNREAD',
      },
    });
  }

  async markAsRead(notificationId: number) {
    return await this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'READ' },
    });
  }

  async markAllAsRead(userId: number) {
    return await this.prisma.notification.updateMany({
      where: {
        userId,
        status: 'UNREAD',
      },
      data: { status: 'READ' },
    });
  }

  async deleteNotification(notificationId: number) {
    return await this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }

  async deleteAllUserNotifications(userId: number) {
    return await this.prisma.notification.deleteMany({
      where: { userId },
    });
  }

  // Helper method to notify admin when ticket is created
  async notifyAdminTicketCreated(ticketId: number, ticketCode: string, userName: string) {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
    });

    for (const admin of admins) {
      await this.prisma.notification.create({
        data: {
          userId: admin.id,
          type: 'TICKET_CREATED' as any,
          title: 'งานใหม่ได้รับการสร้าง',
          message: `${userName} ได้สร้างงานใหม่ ${ticketCode}`,
          ticketId,
          actionUrl: `/admin/repairs?ticket=${ticketCode}`,
          status: 'UNREAD' as any,
        },
      });
    }
  }

  // Helper method to notify user when ticket is assigned
  async notifyTicketAssigned(ticketId: number, userId: number, assignedBy: string) {
    await this.prisma.notification.create({
      data: {
        userId,
        type: 'TICKET_ASSIGNED' as any,
        title: 'มีงานถูกมอบหมายให้คุณ',
        message: `${assignedBy} ได้มอบหมายงานให้คุณ`,
        ticketId,
        actionUrl: `/tickets/${ticketId}`,
        status: 'UNREAD' as any,
      },
    });
  }

  // Helper method to notify user when ticket status changed
  async notifyTicketStatusChanged(ticketId: number, userId: number, newStatus: string) {
    await this.prisma.notification.create({
      data: {
        userId,
        type: 'STATUS_CHANGED' as any,
        title: 'สถานะงานเปลี่ยนแปลง',
        message: `สถานะของงานของคุณเปลี่ยนเป็น ${newStatus}`,
        ticketId,
        actionUrl: `/tickets/${ticketId}`,
        status: 'UNREAD' as any,
      },
    });
  }
}
