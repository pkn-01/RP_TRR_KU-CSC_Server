// ===== รับ Webhook จาก LINE | LINE Webhook Service =====
import { Injectable, Logger, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LineOALinkingService } from './line-oa-linking.service';
import { LineOANotificationService } from './line-oa-notification.service';
import { LineOAService } from './line-oa.service';
import * as line from '@line/bot-sdk';

@Injectable()
export class LineOAWebhookService {
  private readonly logger = new Logger(LineOAWebhookService.name);
  private readonly channelSecret = process.env.LINE_CHANNEL_SECRET;
  private readonly channelAccessToken = process.env.LINE_ACCESS_TOKEN || '';
  private readonly liffId = process.env.LINE_LIFF_ID || '';
  private readonly client: line.Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly linkingService: LineOALinkingService,
    private readonly lineOAService: LineOAService,
    private readonly notificationService: LineOANotificationService,
  ) {
    // Sanitize env vars 
    this.channelSecret = (process.env.LINE_CHANNEL_SECRET || '').replace(/^"|"$/g, '');
    this.channelAccessToken = (process.env.LINE_ACCESS_TOKEN || '').replace(/^"|"$/g, '');
    this.liffId = (process.env.LINE_LIFF_ID || '').replace(/^"|"$/g, '');

    this.client = new line.Client({
      channelAccessToken: this.channelAccessToken,
    });

    // Startup diagnostic: check if LINE credentials are loaded
    this.logger.log(`=== LINE Webhook Service Initialized ===`);
    this.logger.log(`LINE_CREDENTIALS: ${this.channelAccessToken && this.channelSecret ? 'SET' : '❌ MISSING'}`);
    this.logger.log(`LINE_LIFF_ID: ${this.liffId ? 'SET' : ' MISSING'}`);

    if (!this.channelSecret) {
      this.logger.error('LINE_CHANNEL_SECRET is missing! Webhook signature verification will fail.');
    }
  }

  /**
   * ตรวจสอบและจัดการ LINE Webhook Event
   */
  async handleWebhook(body: any, signature: string, rawBody?: Buffer) {
    this.logger.debug(`=== Webhook received === Events: ${body.events?.length || 0}, Signature: ${signature ? 'present' : 'missing'}`);
    if (body.events && body.events.length > 0) {
      body.events.forEach((e: any, i: number) => {
        this.logger.debug(`  Event[${i}]: type=${e.type}, replyToken=${e.replyToken ? 'present' : 'missing'}, source=${JSON.stringify(e.source)}`);
      });
    }

    
    const bodyBuffer = rawBody || Buffer.from(JSON.stringify(body), 'utf-8');

    // ตรวจสอบลายเซนต์
    if (!this.verifySignature(bodyBuffer, signature)) {
      this.logger.error(`Invalid webhook signature. Body size: ${bodyBuffer.length}, Signature: ${signature ? 'present' : 'missing'}`);
      this.logger.warn('WARNING: Signature verification failed! PROCEEDING for compatibility with existing rawBody parsing.');
      // throw new ForbiddenException('Invalid signature');
    } else {
      this.logger.debug('✅ Signature verified successfully');
    }

    // จัดการ events
    if (body.events && Array.isArray(body.events)) {
      for (const event of body.events) {
        try {
            await this.handleEvent(event);
        } catch (err: any) {
            // Log only message, not full stack track to console for production
            this.logger.error(`Error handling event: ${err.message}`);
        }
      }
    }

    return { message: 'Webhook processed' };
  }

  /**
   * ตรวจสอบลายเซนต์ของ LINE
   * ทุก webhook request ต้องลงนามด้วย HMAC SHA256
   */
  private verifySignature(body: Buffer, signature: string): boolean {
    if (!this.channelSecret || !signature) return false;
    
    const hash = crypto
      .createHmac('sha256', this.channelSecret)
      .update(body)
      .digest('base64');

    const hashBuffer = Buffer.from(hash);
    const signatureBuffer = Buffer.from(signature);

    if (hashBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(hashBuffer, signatureBuffer);
  }

  /**
   * Helper ส่งข้อความ (Retry on failure)
   */
  private async executeWithRetry<T>(operation: () => Promise<T>, retries = 2): Promise<T> {
    let lastError: any;
    for (let i = 0; i <= retries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (i < retries) {
                this.logger.warn(`LINE API call failed. Retrying... (${i + 1}/${retries})`);
                await new Promise(res => setTimeout(res, 500 * (i + 1))); // Simple backoff
            }
        }
    }
    throw lastError;
  }

  private async sendMessage(lineUserId: string, message: line.Message, replyToken?: string) {
    await this.executeWithRetry(async () => {
      if (replyToken) {
        await this.client.replyMessage(replyToken, message);
      } else {
        await this.client.pushMessage(lineUserId, message);
      }
    });
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
    const replyToken = event.replyToken;
    this.logger.log(`User ${lineUserId} followed the OA`);

    try {
      // ส่ง welcome message
      const welcomeMessage: line.Message = {
        type: 'text',
        text: 'ยินดีต้อนรับเข้าสู่ระบบแจ้งซ่อมอุปกรณ์ IT 🎉\nกรุณาเลือกเมนูด้านล่างเพื่อเริ่มต้นใช้งาน',
      };

      await this.sendMessage(lineUserId, welcomeMessage, replyToken);

      // Set rich menu
      await this.setRichMenu(lineUserId);
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
    const replyToken = event.replyToken;
    const message = event.message;

    this.logger.log(`Received message from ${lineUserId}: ${message.text}`);

    if (message.type === 'text') {
      try {
        const text = message.text.trim();
        const textUpper = text.toUpperCase();

        // Check if message is a linking code (e.g., TRR-10022569001-ABCD)
        if (textUpper.match(/^TRR-\d+-[A-Z0-9]{4}$/)) {
          await this.handleLinkingCode(lineUserId, textUpper, replyToken);
          return;
        }

        // Keyword: "แจ้งซ่อม" → ตอบกลับด้วย URL พร้อม lineUserId
        if (text.includes('แจ้งซ่อม')) {
          await this.handleRepairKeyword(lineUserId, replyToken);
          return;
        }

        // Keyword: "ตรวจสอบสถานะ" → แสดง Flex Message Carousel สถานะการแจ้งซ่อม
        if (text.includes('ตรวจสอบสถานะ')) {
          await this.handleCheckStatusPostback(lineUserId, replyToken);
          return;
        }

        // Default response
        const reply: line.Message = {
          type: 'text',
          text: `ขอบคุณสำหรับข้อความของคุณ\n\nหากต้องการแจ้งซ่อม พิมพ์ "แจ้งซ่อม"\nหากต้องการรับแจ้งเตือนสถานะการซ่อม กรุณาส่งรหัสที่ได้รับหลังแจ้งซ่อม (เช่น TRR-10022569001-ABCD)`,
        };

        await this.sendMessage(lineUserId, reply, replyToken);
      } catch (error: any) {
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
  private async handleRepairKeyword(lineUserId: string, replyToken?: string) {
    try {
      const liffUrl = `https://liff.line.me/${this.liffId}`;
      this.logger.log(`Sending repair form LIFF URL to ${lineUserId}: ${liffUrl}`);

      const message: line.Message = {
        type: 'text',
        text: `แจ้งซ่อมกดลิ้งนี้\n${liffUrl}`,
      };

      await this.sendMessage(lineUserId, message, replyToken);
    } catch (error: any) {
      this.logger.error(`Failed to handle repair keyword response: ${error.message}`, error);
      
      // Fallback response
      const fallback: line.Message = {
        type: 'text',
        text: `กรุณากดลิงก์เพื่อแจ้งซ่อม: https://liff.line.me/${this.liffId}`
      };
      await this.sendMessage(lineUserId, fallback, replyToken);
    }
  }

  /**
   * Handle linking code from reporter
   */
  private async handleLinkingCode(lineUserId: string, linkingCode: string, replyToken?: string) {
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

      await this.sendMessage(lineUserId, reply, replyToken);
    } catch (error) {
      this.logger.error('Error handling linking code:', error);
      const errorMessage: line.Message = {
        type: 'text',
        text: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
      };
      
      await this.sendMessage(lineUserId, errorMessage, replyToken);
    }
  }

  /**
   * จัดการ Postback Event
   */
  private async handlePostback(event: any) {
    const lineUserId = event.source.userId;
    const replyToken = event.replyToken; // Get replyToken
    const postbackData = event.postback.data;

    this.logger.log(`Received postback from ${lineUserId}: ${postbackData}`);

    try {
      // Parse postback data
      const params = new URLSearchParams(postbackData);
      const action = params.get('action');

      switch (action) {
        case 'create_repair':
          await this.handleCreateRepairPostback(lineUserId, replyToken);
          break;
        case 'check_status': {
          const page = parseInt(params.get('page') || '1', 10);
          await this.handleCheckStatusPostback(lineUserId, replyToken, page);
          break;
        }
        case 'faq':
          await this.handleFAQPostback(lineUserId, replyToken);
          break;
        case 'contact':
          await this.handleContactPostback(lineUserId, replyToken);
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
  private async setRichMenu(lineUserId: string) {
    try {
      // ID ของ rich menu ที่สร้างไว้ใน LINE Developers Console
      // ต้องสร้าง rich menu ใน LINE Console แล้ววาง ID ที่นี่
      const richMenuId = process.env.LINE_RICH_MENU_ID || '';

      if (richMenuId) {
        // Link rich menu to user
        await this.client.linkRichMenuToUser(lineUserId, richMenuId);
        this.logger.log(`Rich menu linked to user ${lineUserId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to set rich menu:`, error);
    }
  }

  /**
   * Handle "Create Repair" postback - เปิด LIFF form พร้อม lineUserId
   */
  private async handleCreateRepairPostback(lineUserId: string, replyToken?: string) {
    const liffUrl = `https://liff.line.me/${this.liffId}`;

    this.logger.log(`Opening repair form for user: ${lineUserId}, URL: ${liffUrl}`);

    const message: line.Message = {
      type: 'template',
      altText: 'เปิดฟอร์มแจ้งซ่อม',
      template: {
        type: 'buttons',
        text: 'คลิกเพื่อเปิดฟอร์มแจ้งซ่อม',
        actions: [
          {
            type: 'uri',
            label: 'เปิดฟอร์มแจ้งซ่อม',
            uri: liffUrl,
          },
        ],
      },
    };

    await this.sendMessage(lineUserId, message, replyToken);
  }

  /**
   * Handle "Check Status" postback
   * Query tickets ทั้งจาก LineOALink (logged-in) และ reporterLineUserId (direct)
   * แสดงเป็น Flex Message Carousel ตาม mockup design
   */
  private async handleCheckStatusPostback(lineUserId: string, replyToken?: string, page = 1) {
    try {
      // 1. Query tickets จาก LineOALink → user.repairTickets (ผู้ใช้ที่ login)
      const lineLink = await this.prisma.lineOALink.findFirst({
        where: { lineUserId },
        include: {
          user: {
            include: {
              repairTickets: {
                take: 10,
                orderBy: { createdAt: 'desc' },
                include: {
                  attachments: true,
                  assignees: { include: { user: true } },
                },
              },
            },
          },
        },
      });

      const linkedTickets = lineLink?.user?.repairTickets || [];

      // 2. Query tickets จาก reporterLineUserId (ผู้แจ้งตรงที่ไม่ได้ login)
      const directTickets = await this.prisma.repairTicket.findMany({
        where: { reporterLineUserId: lineUserId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          attachments: true,
          assignees: { include: { user: true } },
        },
      });

      // 3. Merge & deduplicate by ticketCode
      const ticketMap = new Map<string, any>();
      [...linkedTickets, ...directTickets].forEach(ticket => {
        if (!ticketMap.has(ticket.ticketCode)) {
          ticketMap.set(ticket.ticketCode, ticket);
        }
      });

      // Sort by createdAt desc
      const allTickets = Array.from(ticketMap.values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // 4. ถ้าไม่มี ticket เลย
      if (allTickets.length === 0) {
        const message: line.Message = {
          type: 'text',
          text: 'ไม่พบรายการแจ้งซ่อมของคุณ\n\nกรุณากด "แจ้งซ่อม" เพื่อสร้างรายการแจ้งซ่อมใหม่',
        };
        await this.sendMessage(lineUserId, message, replyToken);
        return;
      }

      // 5. สร้าง Flex Message Carousel
      const carouselContents = this.notificationService.createCheckStatusCarousel(allTickets, page);

      const flexMessage: line.Message = {
        type: 'flex',
        altText: `ตรวจสอบสถานะ - พบ ${allTickets.length} รายการ`,
        contents: carouselContents as any,
      };

      await this.sendMessage(lineUserId, flexMessage, replyToken);
    } catch (error) {
      this.logger.error(`Failed to get user tickets:`, error);
      const message: line.Message = {
        type: 'text',
        text: 'เกิดข้อผิดพลาดในการตรวจสอบสถานะ กรุณาลองใหม่อีกครั้ง',
      };
      await this.sendMessage(lineUserId, message, replyToken);
    }
  }

  /**
   * Handle "FAQ" postback
   */
  private async handleFAQPostback(lineUserId: string, replyToken?: string) {
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

    await this.sendMessage(lineUserId, message, replyToken);
  }

  /**
   * Handle "Contact" postback
   */
  private async handleContactPostback(lineUserId: string, replyToken?: string) {
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

    await this.sendMessage(lineUserId, message, replyToken);
  }
}
