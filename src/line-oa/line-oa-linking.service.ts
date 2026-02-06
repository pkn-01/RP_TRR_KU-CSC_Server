import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import crypto from 'crypto';

@Injectable()
export class LineOALinkingService {
  private readonly logger = new Logger(LineOALinkingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * เริ่มต้นกระบวนการเชื่อมต่อบัญชี LINE
   */
  async initiateLinking(userId: number) {
    // สร้าง verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const expiryTime = new Date(Date.now() + 15 * 60 * 1000); // 15 นาทีจากนี้

    // ตรวจสอบว่าผู้ใช้มีการเชื่อมต่อแล้วหรือไม่
    const existingLink = await this.prisma.lineOALink.findUnique({
      where: { userId },
    });

    if (existingLink && existingLink.status === 'VERIFIED') {
      return {
        message: 'Account already linked',
        isLinked: true,
      };
    }

    // สร้างหรืออัปเดต linking record
    if (existingLink) {
      await this.prisma.lineOALink.update({
        where: { userId },
        data: {
          verificationToken,
          verificationExpiry: expiryTime,
          status: 'PENDING',
        },
      });
    } else {
      await this.prisma.lineOALink.create({
        data: {
          userId,
          lineUserId: '', // ชั่วคราว
          verificationToken,
          verificationExpiry: expiryTime,
          status: 'PENDING',
        },
      });
    }

    // สร้าง LINE login URL
    const linkingUrl = this.generateLinkingUrl(verificationToken);

    return {
      linkingUrl,
      verificationToken,
      expiresIn: 900, // 900 วินาที = 15 นาที
      message:
        'Please scan the QR code or click the link to link your LINE account',
    };
  }

  /**
   * ยืนยันการเชื่อมต่อ LINE
   */
  async verifyLink(
    userId: number,
    lineUserId: string,
    verificationToken: string,
    force: boolean = false,
  ) {
    // ตรวจสอบ linking record
    const linkingRecord = await this.prisma.lineOALink.findFirst({
      where: {
        userId,
        verificationToken,
      },
    });

    if (!linkingRecord) {
      throw new BadRequestException('Invalid verification token');
    }

    // ตรวจสอบว่า token ยังไม่หมดอายุ
    if (
      linkingRecord.verificationExpiry &&
      linkingRecord.verificationExpiry < new Date()
    ) {
      throw new BadRequestException('Verification token expired');
    }

    // ตรวจสอบว่า LINE User ID ไม่ได้ถูกใช้โดยผู้ใช้คนอื่น
    const existingLink = await this.prisma.lineOALink.findFirst({
      where: { lineUserId },
    });

    if (existingLink && existingLink.userId !== userId) {
      if (!force) {
        throw new BadRequestException('This LINE account is already linked');
      }
      
      // Force Link: ลบการเชื่อมต่อเก่า
      this.logger.log(`Force linking: Removing link from user ${existingLink.userId}`);
      await this.prisma.lineOALink.delete({
        where: { userId: existingLink.userId },
      });
    }

    // อัปเดต linking record
    const updatedLink = await this.prisma.lineOALink.update({
      where: { userId },
      data: {
        lineUserId,
        status: 'VERIFIED',
        verificationToken: null,
        verificationExpiry: null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    this.logger.log(`User ${userId} linked with LINE account ${lineUserId}`);

    return {
      message: 'Account linked successfully',
      data: {
        userId: updatedLink.userId,
        lineUserId: updatedLink.lineUserId,
        status: updatedLink.status,
        linkedAt: updatedLink.updatedAt,
      },
    };
  }

  /**
   * ดึงสถานะการเชื่อมต่อ LINE
   */
  async getLinkingStatus(userId: number) {
    const linkingRecord = await this.prisma.lineOALink.findUnique({
      where: { userId },
    });

    if (!linkingRecord) {
      return {
        isLinked: false,
        data: null,
      };
    }

    return {
      isLinked: linkingRecord.status === 'VERIFIED',
      data:
        linkingRecord.status === 'VERIFIED'
          ? {
              lineUserId: linkingRecord.lineUserId,
              displayName: linkingRecord.displayName,
              pictureUrl: linkingRecord.pictureUrl,
              status: linkingRecord.status,
              linkedAt: linkingRecord.updatedAt,
            }
          : null,
    };
  }

  /**
   * ยกเลิกการเชื่อมต่อ LINE
   */
  async unlinkAccount(userId: number) {
    const linkingRecord = await this.prisma.lineOALink.findUnique({
      where: { userId },
    });

    if (!linkingRecord) {
      throw new BadRequestException('No LINE account linked');
    }

    // ลบการเชื่อมต่อ
    await this.prisma.lineOALink.delete({
      where: { userId },
    });

    this.logger.log(`User ${userId} unlinked their LINE account`);

    return {
      message: 'Account unlinked successfully',
    };
  }

  /**
   * สร้าง LINE Login URL
   * ในการใช้งานจริง ต้องปรับตามการตั้งค่า LINE Channel
   */
  private generateLinkingUrl(verificationToken: string): string {
    // URL นี้เป็นตัวอย่าง สำหรับการใช้งานจริง ต้องปรับตาม LINE Configuration
    const baseUrl = process.env.LINE_LOGIN_REDIRECT_URI || 'http://localhost:3000';
    return `${baseUrl}/auth/line/callback?token=${verificationToken}`;
  }

  /**
   * อัปเดตข้อมูล Profile จาก LINE
   */
  async updateProfileFromLine(
    userId: number,
    lineUserId: string,
    displayName: string,
    pictureUrl: string,
  ) {
    const updated = await this.prisma.lineOALink.update({
      where: { userId },
      data: {
        displayName,
        pictureUrl,
      },
    });

    return updated;
  }
}
