import { Module } from '@nestjs/common';
import { LineOAController } from './line-oa.controller';
import { LineOAService } from './line-oa.service';
import { LineOAWebhookService } from './line-oa-webhook.service';
import { LineOALinkingService } from './line-oa-linking.service';
import { LineOANotificationService } from './line-oa-notification.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [LineOAController],
  providers: [
    LineOAService,
    LineOAWebhookService,
    LineOALinkingService,
    LineOANotificationService,
    PrismaService,
  ],
  exports: [LineOAService, LineOAWebhookService, LineOALinkingService, LineOANotificationService],
})
export class LineOAModule {}
