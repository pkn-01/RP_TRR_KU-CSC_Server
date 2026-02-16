import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LineOAService } from './line-oa.service';
import { LineNotificationStatus } from '@prisma/client';

/* =======================
   ENUMS & CONSTANTS
======================= */

const NotificationStatus = LineNotificationStatus;

const COLORS = {
  // Urgency
  CRITICAL: '#DC2626',
  URGENT: '#EA580C',
  NORMAL: '#16A34A',
  // Status
  SUCCESS: '#059669',
  INFO: '#2563EB',
  WARNING: '#D97706',
  SECONDARY: '#6B7280',
  PRIMARY: '#1E293B',
  // UI
  HEADER_DARK: '#0F172A',
  CARD_BG: '#FFFFFF',
  SECTION_BG: '#F8FAFC',
  BORDER: '#E2E8F0',
  LABEL: '#64748B',
  VALUE: '#1E293B',
  SUBTLE: '#94A3B8',
  FOOTER_BG: '#F1F5F9',
};

/* =======================
   INTERFACES
======================= */

export interface LineNotificationPayload {
  type: string;
  title: string;
  message: string;
  actionUrl?: string;
  richMessage?: any;
}

export interface RepairTicketNotificationPayload {
  ticketCode: string;
  ticketId?: number;
  reporterName: string;
  department: string;
  problemTitle: string;
  problemDescription?: string;
  location: string;
  urgency: 'CRITICAL' | 'URGENT' | 'NORMAL';
  createdAt: string;
  reporterPhone?: string;
  imageUrl?: string;
}

export interface RepairStatusUpdatePayload {
  ticketCode: string;
  problemTitle?: string;
  problemDescription?: string;
  status: string;
  remark?: string;
  technicianNames?: string[]; // Changed to array for multi-assignee
  nextStep?: string;
  updatedAt?: Date;
}

/* =======================
   SERVICE
======================= */

@Injectable()
export class LineOANotificationService {
  private readonly logger = new Logger(LineOANotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lineOAService: LineOAService,
  ) {}

  /* =======================
     GENERIC NOTIFICATION
  ======================= */

  async sendNotification(userId: number, payload: LineNotificationPayload) {
    try {
      const lineLink = await this.getVerifiedLineLink(userId);
      if (!lineLink) return { success: false, reason: 'User not linked to LINE' };

      const message = payload.richMessage || this.createDefaultTextMessage(payload);

      await this.lineOAService.sendMessage(lineLink.lineUserId!, message);
      await this.saveNotificationLog(lineLink.lineUserId!, payload, NotificationStatus.SENT);

      return { success: true };
    } catch (error) {
      this.logger.error(error.message);
      await this.logFailure(userId, payload, error.message);
      return { success: false };
    }
  }

  /* =======================
     NOTIFY IT TEAM (NEW TICKET)
  ======================= */

  async notifyRepairTicketToITTeam(payload: RepairTicketNotificationPayload) {
    try {
      const itUsers = await this.prisma.user.findMany({
        where: {
          role: 'IT',
          lineOALink: { status: 'VERIFIED' },
        },
        include: { lineOALink: true },
      });

      const lineUserIds = itUsers
        .map(u => u.lineOALink?.lineUserId)
        .filter((id): id is string => !!id);

      if (lineUserIds.length === 0) return { success: false, reason: 'No IT users linked to LINE' };

      const flexMessage = {
        type: 'flex' as const,
        altText: `งานซ่อมใหม่ ${payload.ticketCode}`,
        contents: this.createRepairTicketFlex(payload) as any,
      };

      await this.lineOAService.sendMulticast(lineUserIds, flexMessage);
      await Promise.all(lineUserIds.map(lineUserId =>
        this.saveNotificationLog(lineUserId, {
          type: 'REPAIR_TICKET_CREATED',
          title: `งานใหม่ ${payload.ticketCode}`,
          message: payload.problemTitle,
        }, NotificationStatus.SENT)
      ));

      return { success: true, count: lineUserIds.length };
    } catch (error) {
      this.logger.error(error.message);
      return { success: false };
    }
  }

  /* =======================
     NOTIFY SPECIFIC TECHNICIAN
  ====================== */

  async notifyTechnicianTaskAssignment(
    technicianId: number,
    payload: {
      ticketCode: string;
      ticketId?: number;
      problemTitle: string;
      problemDescription?: string;
      reporterName: string;
      reporterPhone?: string;
      department?: string;
      location?: string;
      urgency: 'CRITICAL' | 'URGENT' | 'NORMAL';
      action: 'ASSIGNED' | 'TRANSFERRED' | 'CLAIMED';
      imageUrl?: string;
    }
  ) {
    try {
      const lineLink = await this.getVerifiedLineLink(technicianId);
      if (!lineLink) return { success: false, reason: 'Technician not linked to LINE' };

      const actionText = {
        ASSIGNED: 'ได้รับมอบหมายงานใหม่',
        TRANSFERRED: 'มีการโอนงานมาให้คุณ',
        CLAIMED: 'คุณรับงานซ่อมแล้ว',
      }[payload.action];

      const flexMessage = {
        type: 'flex' as const,
        altText: `${actionText} ${payload.ticketCode}`,
        contents: this.createTechnicianAssignmentFlex(payload, actionText) as any,
      };

      await this.lineOAService.sendMessage(lineLink.lineUserId!, flexMessage);
      await this.saveNotificationLog(lineLink.lineUserId!, {
        type: `REPAIR_TICKET_${payload.action}`,
        title: actionText,
        message: `${payload.ticketCode}: ${payload.problemTitle}`,
      }, NotificationStatus.SENT);

      return { success: true };
    } catch (error) {
      this.logger.error(error.message);
      return { success: false };
    }
  }

  /* =======================
     STATUS UPDATE → REPORTER
  ======================= */

  async notifyRepairTicketStatusUpdate(userId: number, payload: RepairStatusUpdatePayload) {
    const lineLink = await this.getVerifiedLineLink(userId);
    if (!lineLink) return { success: false };

    const flexMessage = {
      type: 'flex' as const,
      altText: `อัปเดตสถานะ ${payload.ticketCode}`,
      contents: this.createStatusUpdateFlex(payload) as any,
    };

    try {
      await this.lineOAService.sendMessage(lineLink.lineUserId!, flexMessage);
      await this.saveNotificationLog(lineLink.lineUserId!, {
        type: 'REPAIR_STATUS_UPDATE',
        title: `อัปเดตงาน ${payload.ticketCode}`,
        message: payload.remark || payload.status,
      }, NotificationStatus.SENT);
      return { success: true };
    } catch (error) {
      this.logger.error(error.message);
      return { success: false };
    }
  }

  /* =======================
     NOTIFY REPORTER DIRECTLY (No Login)
  ======================= */

  async notifyReporterDirectly(
    lineUserId: string,
    payload: {
      ticketCode: string;
      status: string;
      urgency: 'CRITICAL' | 'URGENT' | 'NORMAL';
      problemTitle: string;
      description?: string;
      imageUrl?: string;
      createdAt: Date;
      remark?: string;
    }
  ) {
    try {
      const flexMessage = {
        type: 'flex' as const,
        altText: `อัปเดตสถานะ ${payload.ticketCode}`,
        contents: this.createReporterFlexMessage(payload) as any,
      };

      await this.lineOAService.sendMessage(lineUserId, flexMessage);
      await this.saveNotificationLog(lineUserId, {
        type: 'REPAIR_REPORTER_UPDATE',
        title: `อัปเดต ${payload.ticketCode}`,
        message: payload.status,
      }, NotificationStatus.SENT);
      
      this.logger.log(`Sent notification to reporter ${lineUserId} for ${payload.ticketCode}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to notify reporter:`, error.message);
      return { success: false };
    }
  }

  /**
   * Create Flex Message for reporter (matching mockup design)
   */
  private createReporterFlexMessage(payload: {
    ticketCode: string;
    status: string;
    urgency: 'CRITICAL' | 'URGENT' | 'NORMAL';
    problemTitle: string;
    description?: string;
    imageUrl?: string;
    createdAt: Date;
    remark?: string;
  }) {
    const statusConfig = this.getStatusConfig(payload.status);
    const urgencyConfig = this.getUrgencyConfig(payload.urgency);

    const formattedDate = new Intl.DateTimeFormat('th-TH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(payload.createdAt);

    const bodyContents: any[] = [
      // ── Status + Urgency Badges ──
      {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            backgroundColor: statusConfig.color,
            cornerRadius: 'xl',
            paddingAll: '6px', paddingStart: '12px', paddingEnd: '12px',
            contents: [
              { type: 'text', text: statusConfig.text, color: '#FFFFFF', size: 'xs', weight: 'bold' },
            ],
          },
          {
            type: 'box', layout: 'horizontal',
            backgroundColor: urgencyConfig.color + '20',
            cornerRadius: 'xl',
            paddingAll: '6px', paddingStart: '12px', paddingEnd: '12px',
            contents: [
              { type: 'text', text: urgencyConfig.text, color: urgencyConfig.color, size: 'xs', weight: 'bold' },
            ],
          },
        ],
      },
      // ── Ticket ID Section ──
      {
        type: 'box', layout: 'vertical',
        margin: 'lg',
        spacing: 'xs',
        contents: [
          { type: 'text', text: 'หมายเลขงาน', size: 'xxs', color: COLORS.SUBTLE },
          { type: 'text', text: payload.ticketCode, size: 'xl', weight: 'bold', color: COLORS.VALUE },
        ],
      },
      { type: 'separator', margin: 'lg', color: COLORS.BORDER },
      // ── Problem Title ──
      {
        type: 'box', layout: 'vertical',
        margin: 'lg',
        spacing: 'xs',
        contents: [
          { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xxs', color: COLORS.LABEL, weight: 'bold' },
          { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: COLORS.VALUE, wrap: true },
        ],
      },
    ];

    // ── Description Box ──
    if (payload.description && payload.description !== payload.problemTitle) {
      bodyContents.push({
        type: 'box', layout: 'vertical',
        backgroundColor: COLORS.SECTION_BG,
        paddingAll: '12px',
        cornerRadius: 'md',
        margin: 'md',
        contents: [
          { type: 'text', text: 'รายละเอียด', size: 'xxs', color: COLORS.LABEL, weight: 'bold' },
          { type: 'text', text: payload.description, size: 'sm', color: COLORS.VALUE, wrap: true, margin: 'xs' },
        ],
      });
    }

    // ── Remark Box (operation detail from technician/admin) ──
    if (payload.remark) {
      bodyContents.push({
        type: 'box', layout: 'vertical',
        backgroundColor: '#FFF7ED',
        paddingAll: '12px',
        cornerRadius: 'md',
        margin: 'md',
        borderColor: '#FDBA7440',
        borderWidth: '1px',
        contents: [
          { type: 'text', text: 'หมายเหตุจากเจ้าหน้าที่', size: 'xxs', color: '#92400E', weight: 'bold' },
          { type: 'text', text: payload.remark, size: 'sm', color: '#78350F', wrap: true, margin: 'xs' },
        ],
      });
    }

    const contents: any = {
      type: 'bubble',
      size: 'mega',
      // Hero image (if available)
      ...(payload.imageUrl ? {
        hero: {
          type: 'image',
          url: payload.imageUrl,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
        },
      } : {}),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        spacing: 'none',
        backgroundColor: COLORS.CARD_BG,
        contents: bodyContents,
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        paddingAll: '16px',
        backgroundColor: COLORS.FOOTER_BG,
        justifyContent: 'space-between',
        contents: [
          { type: 'text', text: `แจ้งเมื่อ ${formattedDate}`, size: 'xxs', color: COLORS.SUBTLE },
          { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: COLORS.SUBTLE, align: 'end' },
        ],
      },
      styles: {
        footer: { separator: true, separatorColor: COLORS.BORDER },
      },
    };

    return contents;
  }

  /* =======================
     PRIVATE HELPERS
  ======================= */

  private async getVerifiedLineLink(userId: number) {
    const link = await this.prisma.lineOALink.findUnique({ where: { userId } });
    return (link && link.status === 'VERIFIED' && link.lineUserId) ? link : null;
  }

  private async saveNotificationLog(
    lineUserId: string,
    payload: Partial<LineNotificationPayload>,
    status: LineNotificationStatus,
    errorMessage?: string,
  ) {
    return this.prisma.lineNotification.create({
      data: {
        lineUserId,
        type: payload.type ?? '',
        title: payload.title ?? '',
        message: payload.message ?? '',
        status,
        errorMessage,
      },
    });
  }

  private async logFailure(userId: number, payload: LineNotificationPayload, error: string) {
    const link = await this.prisma.lineOALink.findUnique({ where: { userId } });
    if (link?.lineUserId) {
      await this.saveNotificationLog(link.lineUserId, payload, NotificationStatus.FAILED, error);
    }
  }

  private createDefaultTextMessage(payload: LineNotificationPayload) {
    return {
      type: 'text',
      text: `${payload.title}\n\n${payload.message}${payload.actionUrl ? `\n\n${payload.actionUrl}` : ''}`,
    };
  }

  /* =======================
     FLEX FACTORIES
  ======================= */

  private createRepairTicketFlex(payload: RepairTicketNotificationPayload) {
    const urgency = this.getUrgencyConfig(payload.urgency);

    const formattedDate = new Intl.DateTimeFormat('th-TH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(payload.createdAt));

    const bodyContents: any[] = [
      // ── Problem Title ──
      {
        type: 'box', layout: 'vertical',
        spacing: 'xs',
        contents: [
          { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xxs', color: COLORS.LABEL, weight: 'bold' },
          { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: COLORS.VALUE, wrap: true },
        ],
      },
      // ── Info Card ──
      {
        type: 'box', layout: 'vertical',
        backgroundColor: COLORS.SECTION_BG,
        paddingAll: '14px',
        cornerRadius: 'lg',
        margin: 'lg',
        spacing: 'sm',
        contents: [
          this.createInfoRow('', 'ผู้แจ้ง', payload.reporterName, true),
          this.createInfoRow('', 'แผนก', payload.department),
          this.createInfoRow('', 'สถานที่', payload.location),
        ],
      },
    ];

    // ── Description ──
    if (payload.problemDescription) {
      bodyContents.push({
        type: 'box', layout: 'vertical',
        backgroundColor: COLORS.SECTION_BG,
        paddingAll: '12px',
        cornerRadius: 'md',
        margin: 'md',
        contents: [
          { type: 'text', text: 'รายละเอียดเพิ่มเติม', size: 'xxs', color: COLORS.LABEL, weight: 'bold' },
          { type: 'text', text: payload.problemDescription, size: 'sm', color: COLORS.VALUE, wrap: true, margin: 'xs' },
        ],
      });
    }

    // Build action buttons
    const frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    const actionButtons: any[] = [];

    // Phone call button (only if reporterPhone is available)
    if (payload.reporterPhone) {
      actionButtons.push({
        type: 'button',
        action: {
          type: 'uri',
          label: '📞 โทรหาผู้แจ้ง',
          uri: `tel:${payload.reporterPhone}`,
        },
        style: 'primary',
        color: '#059669',
        height: 'sm',
      });
    }

    // Detail view button
    if (payload.ticketId) {
      actionButtons.push({
        type: 'button',
        action: {
          type: 'uri',
          label: '📋 ดูรายละเอียด',
          uri: `${frontendUrl}/admin/repairs/${payload.ticketId}`,
        },
        style: 'primary',
        color: '#2563EB',
        height: 'sm',
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      // Hero image (if reporter attached a photo)
      ...(payload.imageUrl ? {
        hero: {
          type: 'image',
          url: payload.imageUrl,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
        },
      } : {}),
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: COLORS.HEADER_DARK,
        paddingAll: '18px',
        contents: [
          {
            type: 'box', layout: 'vertical', flex: 1,
            contents: [
              { type: 'text', text: 'แจ้งซ่อมใหม่', color: '#FFFFFF', weight: 'bold', size: 'lg' },
              { type: 'text', text: payload.ticketCode, color: '#94A3B8', size: 'sm', margin: 'sm' },
            ],
          },
          {
            type: 'box', layout: 'vertical',
            backgroundColor: urgency.color,
            cornerRadius: 'xl',
            paddingAll: '6px', paddingStart: '12px', paddingEnd: '12px',
            justifyContent: 'center', height: '28px',
            contents: [
              { type: 'text', text: urgency.text, color: '#FFFFFF', size: 'xxs', weight: 'bold' },
            ],
          },
        ],
      },
      body: {
        type: 'box', layout: 'vertical',
        paddingAll: '20px',
        spacing: 'none',
        backgroundColor: COLORS.CARD_BG,
        contents: bodyContents,
      },
      footer: {
        type: 'box', layout: 'vertical',
        paddingAll: '14px',
        backgroundColor: COLORS.FOOTER_BG,
        spacing: 'sm',
        contents: [
          // Action buttons row
          ...(actionButtons.length > 0 ? [{
            type: 'box', layout: 'horizontal',
            spacing: 'sm',
            contents: actionButtons,
          }] : []),
          // Date and system label
          {
            type: 'box', layout: 'horizontal',
            justifyContent: 'space-between',
            margin: actionButtons.length > 0 ? 'md' : 'none',
            contents: [
              { type: 'text', text: `${formattedDate}`, size: 'xxs', color: COLORS.SUBTLE },
              { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: COLORS.SUBTLE, align: 'end' },
            ],
          },
        ],
      },
      styles: {
        footer: { separator: true, separatorColor: COLORS.BORDER },
      },
    };
  }

  private createTechnicianAssignmentFlex(payload: any, actionText: string) {
    const urgency = this.getUrgencyConfig(payload.urgency);

    const formattedDate = new Intl.DateTimeFormat('th-TH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date());

    const bodyContents: any[] = [
      // ── Problem Title ──
      {
        type: 'box', layout: 'vertical',
        spacing: 'xs',
        contents: [
          { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xxs', color: COLORS.LABEL, weight: 'bold' },
          { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: COLORS.VALUE, wrap: true },
        ],
      },
      // ── Info Card ──
      {
        type: 'box', layout: 'vertical',
        backgroundColor: COLORS.SECTION_BG,
        paddingAll: '14px',
        cornerRadius: 'lg',
        margin: 'lg',
        spacing: 'sm',
        contents: [
          this.createInfoRow('', 'ผู้แจ้ง', payload.reporterName, true),
          ...(payload.department ? [this.createInfoRow('', 'แผนก', payload.department)] : []),
          ...(payload.location ? [this.createInfoRow('', 'สถานที่', payload.location)] : []),
        ],
      },
    ];

    // ── Description ──
    if (payload.problemDescription) {
      bodyContents.push({
        type: 'box', layout: 'vertical',
        backgroundColor: COLORS.SECTION_BG,
        paddingAll: '12px',
        cornerRadius: 'md',
        margin: 'md',
        contents: [
          { type: 'text', text: 'รายละเอียดเพิ่มเติม', size: 'xxs', color: COLORS.LABEL, weight: 'bold' },
          { type: 'text', text: payload.problemDescription, size: 'sm', color: COLORS.VALUE, wrap: true, margin: 'xs' },
        ],
      });
    }

    // Build action buttons
    const frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    const actionButtons: any[] = [];

    // Phone call button
    if (payload.reporterPhone) {
      actionButtons.push({
        type: 'button',
        action: {
          type: 'uri',
          label: '📞 โทรหาผู้แจ้ง',
          uri: `tel:${payload.reporterPhone}`,
        },
        style: 'primary',
        color: '#059669',
        height: 'sm',
      });
    }

    // Detail view button
    if (payload.ticketId) {
      actionButtons.push({
        type: 'button',
        action: {
          type: 'uri',
          label: '📋 ดูรายละเอียด',
          uri: `${frontendUrl}/admin/repairs/${payload.ticketId}`,
        },
        style: 'primary',
        color: '#2563EB',
        height: 'sm',
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      // Hero image (if reporter attached a photo)
      ...(payload.imageUrl ? {
        hero: {
          type: 'image',
          url: payload.imageUrl,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
        },
      } : {}),
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: COLORS.HEADER_DARK,
        paddingAll: '18px',
        contents: [
          {
            type: 'box', layout: 'vertical', flex: 1,
            contents: [
              { type: 'text', text: `${actionText}`, color: '#FFFFFF', weight: 'bold', size: 'md' },
              { type: 'text', text: payload.ticketCode, color: '#94A3B8', size: 'sm', margin: 'sm' },
            ],
          },
          {
            type: 'box', layout: 'vertical',
            backgroundColor: urgency.color,
            cornerRadius: 'xl',
            paddingAll: '6px', paddingStart: '12px', paddingEnd: '12px',
            justifyContent: 'center', height: '28px',
            contents: [
              { type: 'text', text: urgency.text, color: '#FFFFFF', size: 'xxs', weight: 'bold' },
            ],
          },
        ],
      },
      body: {
        type: 'box', layout: 'vertical',
        paddingAll: '20px',
        spacing: 'none',
        backgroundColor: COLORS.CARD_BG,
        contents: bodyContents,
      },
      footer: {
        type: 'box', layout: 'vertical',
        paddingAll: '14px',
        backgroundColor: COLORS.FOOTER_BG,
        spacing: 'sm',
        contents: [
          // Action buttons row
          ...(actionButtons.length > 0 ? [{
            type: 'box', layout: 'horizontal',
            spacing: 'sm',
            contents: actionButtons,
          }] : []),
          // Date and system label
          {
            type: 'box', layout: 'horizontal',
            justifyContent: 'space-between',
            margin: actionButtons.length > 0 ? 'md' : 'none',
            contents: [
              { type: 'text', text: `${formattedDate}`, size: 'xxs', color: COLORS.SUBTLE },
              { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: COLORS.SUBTLE, align: 'end' },
            ],
          },
        ],
      },
      styles: {
        footer: { separator: true, separatorColor: COLORS.BORDER },
      },
    };
  }

  private createStatusUpdateFlex(payload: RepairStatusUpdatePayload) {
    const config = this.getStatusConfig(payload.status);

    const formattedDate = new Intl.DateTimeFormat('th-TH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(payload.updatedAt || new Date());

    const hasTechnician = payload.technicianNames && payload.technicianNames.length > 0;

    const bodyContents: any[] = [];

    // ── Status Badge ──
    bodyContents.push({
      type: 'box', layout: 'horizontal',
      contents: [
        {
          type: 'box', layout: 'horizontal',
          backgroundColor: config.color,
          cornerRadius: 'xl',
          paddingAll: '6px', paddingStart: '14px', paddingEnd: '14px',
          contents: [
            { type: 'text', text: config.text, color: '#FFFFFF', size: 'sm', weight: 'bold' },
          ],
        },
      ],
    });

    // ── Ticket Code ──
    bodyContents.push({
      type: 'box', layout: 'vertical',
      margin: 'lg',
      spacing: 'xs',
      contents: [
        { type: 'text', text: 'หมายเลขงาน', size: 'xxs', color: COLORS.SUBTLE },
        { type: 'text', text: payload.ticketCode, size: 'xl', weight: 'bold', color: COLORS.VALUE },
      ],
    });

    // ── Problem Title ──
    if (payload.problemTitle) {
      bodyContents.push({ type: 'separator', margin: 'lg', color: COLORS.BORDER });
      bodyContents.push({
        type: 'box', layout: 'vertical',
        margin: 'lg',
        spacing: 'xs',
        contents: [
          { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xxs', color: COLORS.LABEL, weight: 'bold' },
          { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: COLORS.VALUE, wrap: true },
        ],
      });
    }

    // ── Technician Section ──
    bodyContents.push({
      type: 'box', layout: 'horizontal',
      spacing: 'md',
      alignItems: 'center',
      margin: 'lg',
      paddingAll: '12px',
      backgroundColor: COLORS.SECTION_BG,
      cornerRadius: 'lg',
      contents: [
        {
          type: 'box', layout: 'vertical',
          width: '40px', height: '40px',
          backgroundColor: hasTechnician ? '#ECFDF5' : '#FFFBEB',
          cornerRadius: 'xxl',
          justifyContent: 'center', alignItems: 'center',
          contents: [
            { type: 'text', text: hasTechnician ? '' : '', size: 'lg' },
          ],
        },
        {
          type: 'box', layout: 'vertical', flex: 1,
          contents: [
            { type: 'text', text: 'ผู้รับผิดชอบ', size: 'xxs', color: COLORS.LABEL },
            {
              type: 'text',
              text: hasTechnician ? payload.technicianNames!.join(', ') : 'รอมอบหมาย',
              size: 'sm', weight: 'bold',
              color: hasTechnician ? '#059669' : '#D97706',
              wrap: true,
            },
          ],
        },
      ],
    });

    // ── Remark ──
    if (payload.remark) {
      bodyContents.push({
        type: 'box', layout: 'vertical',
        backgroundColor: '#FFF7ED',
        paddingAll: '12px',
        cornerRadius: 'md',
        margin: 'md',
        borderColor: '#FDBA7440',
        borderWidth: '1px',
        contents: [
          { type: 'text', text: 'หมายเหตุ', size: 'xxs', color: '#92400E', weight: 'bold' },
          { type: 'text', text: payload.remark, size: 'sm', color: '#78350F', wrap: true, margin: 'xs' },
        ],
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box', layout: 'vertical',
        paddingAll: '20px',
        spacing: 'none',
        backgroundColor: COLORS.CARD_BG,
        contents: bodyContents,
      },
      footer: {
        type: 'box', layout: 'horizontal',
        paddingAll: '14px',
        backgroundColor: COLORS.FOOTER_BG,
        justifyContent: 'space-between',
        contents: [
          { type: 'text', text: `อัปเดต ${formattedDate}`, size: 'xxs', color: COLORS.SUBTLE },
          { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: COLORS.SUBTLE, align: 'end' },
        ],
      },
      styles: {
        footer: { separator: true, separatorColor: COLORS.BORDER },
      },
    };
  }

  /**
   * Helper: create a labeled info row with icon for use in info boxes
   */
  private createInfoRow(icon: string, label: string, value: string, bold = false) {
    return {
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        { type: 'text', text: `${icon} ${label}`, size: 'xs', color: COLORS.LABEL, flex: 3 },
        { type: 'text', text: value, size: 'xs', color: COLORS.VALUE, flex: 5, weight: bold ? 'bold' : 'regular', wrap: true },
      ],
    };
  }

  private getUrgencyConfig(level: string): { color: string; text: string } {
    return ({
      CRITICAL: { color: COLORS.CRITICAL, text: 'ด่วนที่สุด' },
      URGENT: { color: COLORS.URGENT, text: 'ด่วน' },
      NORMAL: { color: COLORS.NORMAL, text: 'ปกติ' },
    }[level] || { color: COLORS.NORMAL, text: 'ปกติ' });
  }

  private getStatusConfig(status: string): { color: string; text: string } {
    return ({
      PENDING: { color: COLORS.WARNING, text: 'รอดำเนินการ' },
      ASSIGNED: { color: COLORS.INFO, text: 'มอบหมายแล้ว' },
      IN_PROGRESS: { color: COLORS.INFO, text: 'กำลังดำเนินการ' },
      COMPLETED: { color: COLORS.SUCCESS, text: 'เสร็จสิ้น' },
      WAITING_PARTS: { color: COLORS.WARNING, text: 'รออะไหล่' },
      WAITING_USER: { color: COLORS.WARNING, text: 'รอข้อมูลจากผู้แจ้ง' },
      CANCELLED: { color: COLORS.SECONDARY, text: 'ยกเลิก' },
    }[status] || { color: COLORS.PRIMARY, text: status });
  }
}
