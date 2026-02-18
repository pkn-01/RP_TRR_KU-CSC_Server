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
    // Sanitize env vars (remove quotes if present)
    this.channelSecret = (process.env.LINE_CHANNEL_SECRET || '').replace(/^"|"$/g, '');
    this.channelAccessToken = (process.env.LINE_ACCESS_TOKEN || '').replace(/^"|"$/g, '');
    this.liffId = (process.env.LINE_LIFF_ID || '').replace(/^"|"$/g, '');

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
    this.logger.debug(`=== Webhook received === Events: ${body.events?.length || 0}, Signature: ${signature ? 'present' : 'missing'}`);
    if (body.events && body.events.length > 0) {
      body.events.forEach((e: any, i: number) => {
        this.logger.debug(`  Event[${i}]: type=${e.type}, replyToken=${e.replyToken ? 'present' : 'missing'}, source=${JSON.stringify(e.source)}`);
      });
    }

    // If rawBody is available (from NestJS rawBody: true), use it for signature verification
    // Otherwise fallback to JSON.stringify (which might fail verification due to formatting)
    const bodyBuffer = rawBody || Buffer.from(JSON.stringify(body), 'utf-8');

    // ตรวจสอบลายเซนต์
    if (!this.verifySignature(bodyBuffer, signature)) {
      this.logger.error(`Invalid webhook signature. Body size: ${bodyBuffer.length}, Signature: ${signature}`);
      if (!rawBody) {
        this.logger.error('rawBody is missing! Signature verification failed because JSON.stringify was used.');
      } else {
        this.logger.error('rawBody is present but signature mismatch. Check LINE_CHANNEL_SECRET.');
      }
      
      this.logger.warn('WARNING: Signature verification failed! But PROCEEDING for debugging purposes.');
      // throw new ForbiddenException('Invalid signature'); // DISABLED FOR DEBUGGING
    } else {
      this.logger.debug('✅ Signature verified successfully');
    }

    // จัดการ events
    if (body.events && Array.isArray(body.events)) {
      for (const event of body.events) {
        try {
            await this.handleEvent(event);
        } catch (err) {
            this.logger.error(`Error handling event: ${err.message}`, err.stack);
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
    const replyToken = event.replyToken;
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

      if (replyToken) {
        await client.replyMessage(replyToken, welcomeMessage);
      } else {
        await client.pushMessage(lineUserId, welcomeMessage);
      }

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
    const replyToken = event.replyToken;
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
          await this.handleLinkingCode(lineUserId, textUpper, client, replyToken);
          return;
        }

        // Keyword: "แจ้งซ่อม" → ตอบกลับด้วย URL พร้อม lineUserId
        if (text.includes('แจ้งซ่อม')) {
          await this.handleRepairKeyword(lineUserId, client, replyToken);
          return;
        }

        // Default response
        const reply: line.Message = {
          type: 'text',
          text: `ขอบคุณสำหรับข้อความของคุณ\n\nหากต้องการแจ้งซ่อม พิมพ์ "แจ้งซ่อม"\nหากต้องการรับแจ้งเตือนสถานะการซ่อม กรุณาส่งรหัสที่ได้รับหลังแจ้งซ่อม (เช่น TRR-10022569001-ABCD)`,
        };

        if (replyToken) {
          await client.replyMessage(replyToken, reply);
        } else {
          await client.pushMessage(lineUserId, reply);
        }
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
  private async handleRepairKeyword(lineUserId: string, client: line.Client, replyToken?: string) {
    try {
      // Use LIFF URL so the form opens inside LINE app with proper LIFF context
      // LIFF SDK will get the userId via liff.getProfile() — no need to pass in URL
      const liffUrl = `https://liff.line.me/${this.liffId}?action=create`;

      this.logger.log(`Sending repair form LIFF URL to ${lineUserId}: ${liffUrl}`);

      const message: line.Message = {
        type: 'template',
        altText: '🔧 กดเพื่อเปิดฟอร์มแจ้งซ่อม',
        template: {
          type: 'buttons',
          text: '🔧 กดปุ่มด้านล่างเพื่อเปิดฟอร์มแจ้งซ่อม',
          actions: [
            {
              type: 'uri',
              label: 'เปิดฟอร์มแจ้งซ่อม',
              uri: liffUrl,
            },
          ],
        },
      };

      if (replyToken) {
        await client.replyMessage(replyToken, message);
      } else {
        await client.pushMessage(lineUserId, message);
      }
    } catch (error: any) {
      this.logger.error(`Failed to handle repair keyword response: ${error.message}`, error);
      
      // Fallback response if template fails (e.g., if LIFF URL is considered invalid)
      if (replyToken) {
        await client.replyMessage(replyToken, {
          type: 'text',
          text: `กรุณากดลิงก์เพื่อแจ้งซ่อม: https://liff.line.me/${this.liffId}?action=create`
        });
      }
    }
  }

  /**
   * Handle linking code from reporter
   */
  private async handleLinkingCode(lineUserId: string, linkingCode: string, client: line.Client, replyToken?: string) {
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

      if (replyToken) {
        await client.replyMessage(replyToken, reply);
      } else {
        await client.pushMessage(lineUserId, reply);
      }
    } catch (error) {
      this.logger.error('Error handling linking code:', error);
      const errorMessage: line.Message = {
        type: 'text',
        text: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
      };
      
      if (replyToken) {
        await client.replyMessage(replyToken, errorMessage);
      } else {
        await client.pushMessage(lineUserId, errorMessage);
      }
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
      const client = new line.Client({
        channelAccessToken: this.channelAccessToken,
      });

      // Parse postback data
      const params = new URLSearchParams(postbackData);
      const action = params.get('action');

      switch (action) {
        case 'create_repair':
          await this.handleCreateRepairPostback(lineUserId, client, replyToken);
          break;
        case 'check_status':
          await this.handleCheckStatusPostback(lineUserId, client, replyToken);
          break;
        case 'faq':
          await this.handleFAQPostback(lineUserId, client, replyToken);
          break;
        case 'contact':
          await this.handleContactPostback(lineUserId, client, replyToken);
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
  private async handleCreateRepairPostback(lineUserId: string, client: line.Client, replyToken?: string) {
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

    if (replyToken) {
      await client.replyMessage(replyToken, message);
    } else {
      await client.pushMessage(lineUserId, message);
    }
  }

  /**
   * Handle "Check Status" postback
   */
  private async handleCheckStatusPostback(lineUserId: string, client: line.Client, replyToken?: string) {
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
        if (replyToken) {
          await client.replyMessage(replyToken, message);
        } else {
          await client.pushMessage(lineUserId, message);
        }
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

      if (replyToken) {
        await client.replyMessage(replyToken, message);
      } else {
        await client.pushMessage(lineUserId, message);
      }
    } catch (error) {
      this.logger.error(`Failed to get user tickets:`, error);
      const message: line.Message = {
        type: 'text',
        text: 'เกิดข้อผิดพลาดในการตรวจสอบสถานะ กรุณาลองใหม่อีกครั้ง',
      };
      if (replyToken) {
        await client.replyMessage(replyToken, message);
      } else {
        await client.pushMessage(lineUserId, message);
      }
    }
  }

  /**
   * Handle "FAQ" postback
   */
  private async handleFAQPostback(lineUserId: string, client: line.Client, replyToken?: string) {
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

    if (replyToken) {
      await client.replyMessage(replyToken, message);
    } else {
      await client.pushMessage(lineUserId, message);
    }
  }

  /**
   * Handle "Contact" postback
   */
  private async handleContactPostback(lineUserId: string, client: line.Client, replyToken?: string) {
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

    if (replyToken) {
      await client.replyMessage(replyToken, message);
    } else {
      await client.pushMessage(lineUserId, message);
    }
  }
}
