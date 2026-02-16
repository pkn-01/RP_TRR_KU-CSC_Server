import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LineOALinkingService } from './line-oa-linking.service';
import { LineOAService } from './line-oa.service';
import * as line from '@line/bot-sdk';

@Injectable()
export class LineOAWebhookService {
  private readonly logger = new Logger(LineOAWebhookService.name);
  private readonly channelSecret = process.env.LINE_CHANNEL_SECRET;
  private readonly channelAccessToken = process.env.LINE_ACCESS_TOKEN || '';
  private readonly liffId = process.env.LINE_LIFF_ID || '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly linkingService: LineOALinkingService,
    private readonly lineOAService: LineOAService,
  ) {
    // Startup diagnostic: check if LINE credentials are loaded
    this.logger.log(`=== LINE Webhook Service Initialized ===`);
    this.logger.log(`LINE_ACCESS_TOKEN: ${this.channelAccessToken ? `SET (${this.channelAccessToken.substring(0, 10)}...)` : '❌ MISSING'}`);
    this.logger.log(`LINE_CHANNEL_SECRET: ${this.channelSecret ? `SET (${this.channelSecret.substring(0, 6)}...)` : '❌ MISSING'}`);
    this.logger.log(`LINE_LIFF_ID: ${this.liffId ? `SET (${this.liffId})` : '❌ MISSING'}`);

    if (!this.channelSecret) {
      this.logger.error('LINE_CHANNEL_SECRET is missing! Webhook signature verification will fail.');
    }
  }

  /**
   * ตรวจสอบและจัดการ LINE Webhook Event
   */
  async handleWebhook(body: any, signature: string, rawBody?: Buffer) {
    this.logger.log(`=== Webhook received === Events: ${body.events?.length || 0}, Signature: ${signature ? 'present' : 'missing'}`);
    if (body.events && body.events.length > 0) {
      body.events.forEach((e: any, i: number) => {
        this.logger.log(`  Event[${i}]: type=${e.type}, replyToken=${e.replyToken ? 'present' : 'missing'}, source=${JSON.stringify(e.source)}`);
      });
    }

    // If rawBody is available (from NestJS rawBody: true), use it for signature verification
    // Otherwise fallback to JSON.stringify (which might fail verification due to formatting)
    const bodyBuffer = rawBody || Buffer.from(JSON.stringify(body), 'utf-8');

    // ตรวจสอบลายเซนต์
    // ตรวจสอบลายเซนต์
    if (!this.verifySignature(bodyBuffer, signature)) {
      this.logger.error(`Invalid webhook signature. Body size: ${bodyBuffer.length}, Signature: ${signature}`);
      if (!rawBody) {
        this.logger.error('rawBody is missing! Signature verification failed because JSON.stringify was used.');
      }
      
      this.logger.warn('WARNING: Signature verification failed! Rejecting request.');
      throw new ForbiddenException('Invalid signature');
    } else {
      this.logger.log('✅ Signature verified successfully');
    }

    // จัดการ events
    if (body.events && Array.isArray(body.events)) {
      for (const event of body.events) {
        await this.handleEvent(event);
      }
    }

    return { message: 'Webhook processed (signature check skipped for debug)' };
  }

  /**
   * ตรวจสอบลายเซนต์ของ LINE
   * ทุก webhook request ต้องลงนามด้วย HMAC SHA256
   */
  private verifySignature(body: Buffer, signature: string): boolean {
    if (!this.channelSecret) return false;
    
    const hash = crypto
      .createHmac('sha256', this.channelSecret)
      .update(body)
      .digest('base64');

    return hash === signature;
  }

  /**
   * จัดการ LINE Event
   */
  private async handleEvent(event: any) {
    this.logger.debug(`Received event: ${event.type}`);

    switch (event.type) {
      case 'follow':
        await this.handleFollow(event);
        break;

      case 'unfollow':
        await this.handleUnfollow(event);
        break;

      case 'message':
        await this.handleMessage(event);
        break;

      case 'postback':
        await this.handlePostback(event);
        break;

      default:
        this.logger.warn(`Unknown event type: ${event.type}`);
    }
  }

  /**
   * จัดการ Follow Event - ส่ง welcome message + rich menu
   */
  private async handleFollow(event: any) {
    const lineUserId = event.source.userId;
    this.logger.log(`User ${lineUserId} followed the OA`);

    try {
      const client = new line.Client({
        channelAccessToken: this.channelAccessToken,
      });

      // ส่ง welcome message
      const welcomeMessage: line.Message = {
        type: 'text',
        text: 'ยินดีต้อนรับเข้าสู่ระบบแจ้งซ่อมอุปกรณ์ IT 🎉\nกรุณาเลือกเมนูด้านล่างเพื่อเริ่มต้นใช้งาน',
      };

      await client.pushMessage(lineUserId, welcomeMessage);

      // Set rich menu
      await this.setRichMenu(lineUserId, client);
    } catch (error) {
      this.logger.error(`Failed to handle follow event for ${lineUserId}:`, error);
    }
  }

  /**
   * จัดการ Unfollow Event
   */
  private async handleUnfollow(event: any) {
    const lineUserId = event.source.userId;
    this.logger.log(`User ${lineUserId} unfollowed the OA`);

    try {
      await this.prisma.lineOALink.updateMany({
        where: { lineUserId },
        data: { status: 'UNLINKED' },
      });
    } catch (error) {
      this.logger.error(`Failed to unlink user ${lineUserId}:`, error);
    }
  }

  /**
   * จัดการ Message Event
   */
  private async handleMessage(event: any) {
    const lineUserId = event.source.userId;
    const message = event.message;

    this.logger.log(`Received message from ${lineUserId}: ${message.text}`);

    if (message.type === 'text') {
      try {
        const client = new line.Client({
          channelAccessToken: this.channelAccessToken,
        });

        const text = message.text.trim();
        const textUpper = text.toUpperCase();

        // Check if message is a linking code (e.g., TRR-10022569001-ABCD)
        if (textUpper.match(/^TRR-\d+-[A-Z0-9]{4}$/)) {
          await this.handleLinkingCode(lineUserId, textUpper, client);
          return;
        }

        // Keyword: "แจ้งซ่อม" → ตอบกลับด้วย URL พร้อม lineUserId
        if (text.includes('แจ้งซ่อม')) {
          await this.handleRepairKeyword(lineUserId, client);
          return;
        }

        // Default response
        const reply: line.Message = {
          type: 'text',
          text: `ขอบคุณสำหรับข้อความของคุณ\n\nหากต้องการแจ้งซ่อม พิมพ์ "แจ้งซ่อม"\nหากต้องการรับแจ้งเตือนสถานะการซ่อม กรุณาส่งรหัสที่ได้รับหลังแจ้งซ่อม (เช่น TRR-10022569001-ABCD)`,
        };

        await client.pushMessage(lineUserId, reply);
      } catch (error) {
        this.logger.error(`Failed to reply to message from ${lineUserId}:`, error?.message || error);
        if (error?.statusCode) {
          this.logger.error(`LINE API Status: ${error.statusCode}, Body: ${JSON.stringify(error.originalError?.response?.data || error.body || 'N/A')}`);
        }
      }
    }
  }

  /**
   * Handle "แจ้งซ่อม" keyword → ส่ง URL พร้อม lineUserId เพื่อเปิดฟอร์มแจ้งซ่อม
   * ผู้ใช้จะได้รับ notification อัตโนมัติเพราะ lineUserId ถูกส่งไปกับ URL
   */
  private async handleRepairKeyword(lineUserId: string, client: line.Client) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    const repairFormUrl = `${frontendUrl}/repairs/liff/form?lineUserId=${lineUserId}`;

    this.logger.log(`Sending repair form URL to ${lineUserId}: ${repairFormUrl}`);

    const message: line.Message = {
      type: 'text',
      text: `🔧 แจ้งซ่อมกดลิ้งนี้\n${repairFormUrl}`,
    };

    await client.pushMessage(lineUserId, message);
  }

  /**
   * Handle linking code from reporter
   */
  private async handleLinkingCode(lineUserId: string, linkingCode: string, client: line.Client) {
    try {
      const result = await this.linkingService.linkReporterLine(linkingCode, lineUserId);

      let reply: line.Message;
      if (result.success) {
        reply = {
          type: 'text',
          text: `ลงทะเบียนสำเร็จ!\n\nรหัสงาน: ${result.ticketCode}\n\nคุณจะได้รับแจ้งเตือนเมื่อสถานะการซ่อมมีการเปลี่ยนแปลง`,
        };
      } else {
        reply = {
          type: 'text',
          text: `${result.error}`,
        };
      }

      await client.pushMessage(lineUserId, reply);
    } catch (error) {
      this.logger.error('Error handling linking code:', error);
      await client.pushMessage(lineUserId, {
        type: 'text',
        text: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
      });
    }
  }

  /**
   * จัดการ Postback Event
   */
  private async handlePostback(event: any) {
    const lineUserId = event.source.userId;
    const postbackData = event.postback.data;

    this.logger.log(`Received postback from ${lineUserId}: ${postbackData}`);

    try {
      const client = new line.Client({
        channelAccessToken: this.channelAccessToken,
      });

      // Parse postback data
      const params = new URLSearchParams(postbackData);
      const action = params.get('action');

      switch (action) {
        case 'create_repair':
          await this.handleCreateRepairPostback(lineUserId, client);
          break;
        case 'check_status':
          await this.handleCheckStatusPostback(lineUserId, client);
          break;
        case 'faq':
          await this.handleFAQPostback(lineUserId, client);
          break;
        case 'contact':
          await this.handleContactPostback(lineUserId, client);
          break;
        default:
          this.logger.warn(`Unknown postback action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`Failed to handle postback:`, error);
    }
  }

  /**
   * Set Rich Menu สำหรับ User
   */
  private async setRichMenu(lineUserId: string, client: line.Client) {
    try {
      // ID ของ rich menu ที่สร้างไว้ใน LINE Developers Console
      // ต้องสร้าง rich menu ใน LINE Console แล้ววาง ID ที่นี่
      const richMenuId = process.env.LINE_RICH_MENU_ID || '';

      if (richMenuId) {
        // Link rich menu to user (ถ้า API รองรับ)
        // await client.linkRichMenuToUser(lineUserId, richMenuId);
        this.logger.log(`Rich menu linked to user ${lineUserId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to set rich menu:`, error);
    }
  }

  /**
   * Handle "Create Repair" postback - เปิด LIFF form
   */
  private async handleCreateRepairPostback(lineUserId: string, client: line.Client) {
    // Use proper LIFF URL format - LIFF page will get userId from liff.getProfile()
    // action=create tells the LIFF page to redirect to the form
    const liffUrl = `https://liff.line.me/${this.liffId}?action=create`;

    this.logger.log(`Opening LIFF form for user: ${lineUserId}, URL: ${liffUrl}`);

    const message: line.Message = {
      type: 'template',
      altText: 'เปิดฟอร์มแจ้งซ่อม',
      template: {
        type: 'buttons',
        text: '🔧 คลิกเพื่อเปิดฟอร์มแจ้งซ่อม',
        actions: [
          {
            type: 'uri',
            label: 'เปิดฟอร์มแจ้งซ่อม',
            uri: liffUrl,
          },
        ],
      },
    };

    await client.pushMessage(lineUserId, message);
  }

  /**
   * Handle "Check Status" postback
   */
  private async handleCheckStatusPostback(lineUserId: string, client: line.Client) {
    try {
      // ค้นหาการเชื่อมต่อ LINE ของผู้ใช้
      const lineLink = await this.prisma.lineOALink.findFirst({
        where: { lineUserId },
        include: {
          user: {
            include: {
              repairTickets: {
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: {
                  assignees: { include: { user: true } },
                },
              },
            },
          },
        },
      });

      if (!lineLink || !lineLink.user || lineLink.user.repairTickets.length === 0) {
        const message: line.Message = {
          type: 'text',
          text: '📋 ไม่พบรายการแจ้งซ่อมของคุณ\n\nกรุณากด "🔧 แจ้งซ่อม" เพื่อสร้างรายการแจ้งซ่อมใหม่',
        };
        await client.pushMessage(lineUserId, message);
        return;
      }

      // สร้าง message แสดงสถานะ
      let statusText = '📋 รายการแจ้งซ่อมของคุณ\n\n';
      const emojis = {
        PENDING: '⏳',
        IN_PROGRESS: '🟡',
        WAITING_PARTS: '🔵',
        COMPLETED: '✅',
        CANCELLED: '❌',
      };

      lineLink.user.repairTickets.forEach((ticket) => {
        const emoji = emojis[ticket.status] || '❓';
        statusText += `${emoji} ${ticket.ticketCode}\n`;
        statusText += `ปัญหา: ${ticket.problemTitle}\n`;
        statusText += `สถานะ: ${ticket.status}\n`;
        if (ticket.assignees && ticket.assignees.length > 0) {
          const names = ticket.assignees.map((a: any) => a.user.name).join(', ');
          statusText += `ผู้รับผิดชอบ: ${names}\n`;
        }
        statusText += '\n';
      });

      const message: line.Message = {
        type: 'text',
        text: statusText,
      };

      await client.pushMessage(lineUserId, message);
    } catch (error) {
      this.logger.error(`Failed to get user tickets:`, error);
      const message: line.Message = {
        type: 'text',
        text: 'เกิดข้อผิดพลาดในการตรวจสอบสถานะ กรุณาลองใหม่อีกครั้ง',
      };
      await client.pushMessage(lineUserId, message);
    }
  }

  /**
   * Handle "FAQ" postback
   */
  private async handleFAQPostback(lineUserId: string, client: line.Client) {
    const message: line.Message = {
      type: 'text',
      text: `❓ คำถามที่พบบ่อย (FAQ)

1️⃣ จะแจ้งซ่อมได้ยังไง?
→ กด "🔧 แจ้งซ่อม" และกรอกแบบฟอร์มพร้อมรูปภาพ

2️⃣ ตรวจสอบสถานะได้ยังไง?
→ กด "📋 ตรวจสอบสถานะ" เพื่อดูรายการของคุณ

3️⃣ เลขที่รายการ (Ticket) คืออะไร?
→ เลขที่อ้างอิงของรายการแจ้งซ่อม เช่น TRR-10022569001

4️⃣ รายการแจ้งซ่อมใช้เวลานานเท่าไหร่?
→ ตามความเร่งด่วน: ปกติ (3-5 วัน), ด่วน (1-2 วัน), ด่วนมาก (วันเดียว)

5️⃣ ติดต่อฝ่าย IT ได้ยังไง?
→ กด "📞 ติดต่อฝ่าย IT" เพื่อดูข้อมูลติดต่อ`,
    };

    await client.pushMessage(lineUserId, message);
  }

  /**
   * Handle "Contact" postback
   */
  private async handleContactPostback(lineUserId: string, client: line.Client) {
    const message: line.Message = {
      type: 'text',
      text: `📞 ติดต่อฝ่าย IT

📧 Email: it-support@company.com
☎️ โทรศัพท์: 02-123-4567 (ต่อ 1000)
💬 LINE: @it-support

⏰ เวลาทำการ:
จันทร์ - ศุกร์: 09:00 - 18:00
วันหยุดทำการ: ปิด

⚡ ในกรณีฉุกเฉิน:
โทรศัพท์: 081-456-7890 (24 ชม.)`,
    };

    await client.pushMessage(lineUserId, message);
  }
}
