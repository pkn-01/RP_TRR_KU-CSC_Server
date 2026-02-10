import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Headers,
  HttpCode,
  Query,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { LineOAService } from './line-oa.service';
import { LineOALinkingService } from './line-oa-linking.service';
import { LineOAWebhookService } from './line-oa-webhook.service';

@Controller('/api/line-oa')
export class LineOAController {
  constructor(
    private readonly lineOAService: LineOAService,
    private readonly linkingService: LineOALinkingService,
    private readonly webhookService: LineOAWebhookService,
  ) {}

  // ... (keep existing code)

  /**
   * LINE Webhook Endpoint
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Body() body: any,
    @Headers('x-line-signature') signature: string,
    @Req() req: Request,
  ) {
    const rawBody = (req as any).rawBody;
    return await this.webhookService.handleWebhook(
      body,
      signature || '',
      rawBody,
    );
  }

  // ===================== Notifications =====================

  /**
   * ดึงประวัติการแจ้งเตือนผ่าน LINE
   */
  @Get('notifications')
  async getNotifications(
    @Query('userId') userId: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return await this.lineOAService.getNotifications(
      parseInt(userId) || 1,
      parseInt(limit) || 20,
    );
  }

  // ===================== Health Check =====================

  /**
   * ตรวจสอบสถานะการทำงาน
   */
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      message: 'LINE OA integration is running',
    };
  }
}
