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
import { Public } from '../auth/public.decorator';

@Controller('/api/line-oa')
export class LineOAController {
  constructor(
    private readonly lineOAService: LineOAService,
    private readonly linkingService: LineOALinkingService,
    private readonly webhookService: LineOAWebhookService,
  ) {}

  // ===================== Webhook =====================

  /**
   * LINE Webhook Endpoint
   */
  @Public()
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

  // ===================== Linking =====================

  /**
   * ดึงสถานะการเชื่อมต่อ LINE
   */
  @Get('linking/status')
  async getLinkingStatus(@Query('userId') userId: string) {
    return await this.linkingService.getLinkingStatus(parseInt(userId));
  }

  /**
   * เริ่มต้นกระบวนการเชื่อมต่อบัญชี LINE
   */
  @Post('linking/initiate')
  async initiateLinking(@Body() body: { userId: number }) {
    return await this.linkingService.initiateLinking(body.userId);
  }

  /**
   * ยืนยันการเชื่อมต่อ LINE
   */
  @Post('linking/verify')
  async verifyLink(
    @Body() body: { userId: number; lineUserId: string; verificationToken: string; force?: boolean },
  ) {
    return await this.linkingService.verifyLink(
      body.userId,
      body.lineUserId,
      body.verificationToken,
      body.force || false,
    );
  }

  /**
   * ยกเลิกการเชื่อมต่อ LINE
   */
  @Delete('linking/unlink')
  async unlinkAccount(@Query('userId') userId: string) {
    return await this.linkingService.unlinkAccount(parseInt(userId));
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
