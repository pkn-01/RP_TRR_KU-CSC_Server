import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as line from '@line/bot-sdk';

@Injectable()
export class LineOAService {
  private readonly logger = new Logger(LineOAService.name);
  private readonly lineClient: line.Client;

  constructor(private readonly prisma: PrismaService) {
    // Initialize LINE Bot SDK Client
    this.lineClient = new line.Client({
      channelSecret: process.env.LINE_CHANNEL_SECRET || '',
      channelAccessToken: process.env.LINE_ACCESS_TOKEN || '',
    });
    this.logger.log('LINE OA service initialized with credentials');
  }

  /**
   * ส่งข้อความไปยัง LINE User
   */
  async sendMessage(lineUserId: string, message: line.Message) {
    try {
      await this.lineClient.pushMessage(lineUserId, message);
      this.logger.log(`Message sent to ${lineUserId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send message to ${lineUserId}:`, error);
      throw error;
    }
  }

  /**
   * ส่งข้อความไปยัง LINE Users หลายคน (Multicast)
   */
  async sendMulticast(lineUserIds: string[], message: line.Message) {
    try {
      if (lineUserIds.length === 0) {
        this.logger.warn('No recipients for multicast');
        return { success: false, reason: 'No recipients' };
      }
      await this.lineClient.multicast(lineUserIds, message);
      this.logger.log(`Multicast sent to ${lineUserIds.length} users`);
      return { success: true, count: lineUserIds.length };
    } catch (error) {
      this.logger.error(`Failed to send multicast:`, error);
      throw error;
    }
  }

  /**
   * ดึงประวัติการแจ้งเตือน LINE ของผู้ใช้
   */
  async getNotifications(userId: number, limit: number = 20) {
    // หาการเชื่อมต่อ LINE ของผู้ใช้
    const lineLink = await this.prisma.lineOALink.findUnique({
      where: { userId },
    });

    if (!lineLink || !lineLink.lineUserId) {
      return {
        isLinked: false,
        data: [],
      };
    }

    // ดึงประวัติการแจ้งเตือน
    const notifications = await this.prisma.lineNotification.findMany({
      where: { lineUserId: lineLink.lineUserId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      isLinked: true,
      data: notifications,
      total: notifications.length,
    };
  }

  /**
   * ทดสอบการเชื่อมต่อกับ LINE
   */
  async testConnection(): Promise<boolean> {
    try {
      this.logger.log('Testing LINE connection');
      // Test by getting bot info
      const botInfo = await this.lineClient.getBotInfo();
      this.logger.log(`Connected to LINE Bot: ${botInfo.displayName}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to connect to LINE:', error);
      return false;
    }
  }
}
