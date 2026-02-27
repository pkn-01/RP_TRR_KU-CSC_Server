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
      adminNote?: string;
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
     NOTIFY TECHNICIAN (JOB COMPLETED)
  ====================== */

  async notifyTechnicianJobCompletion(
    technicianId: number,
    payload: {
      ticketCode: string;
      ticketId?: number;
      problemTitle: string;
      reporterName: string;
      department?: string;
      location?: string;
      completedAt: Date;
      completionNote?: string;
      reporterLineUserId?: string; // Removed (unused)
      problemImageUrl?: string; // Added to show problem image
    }
  ) {
    try {
      const lineLink = await this.getVerifiedLineLink(technicianId);
      if (!lineLink) return { success: false, reason: 'Technician not linked to LINE' };

      const flexMessage = {
        type: 'flex' as const,
        altText: `ปิดงานซ่อม ${payload.ticketCode} เรียบร้อยแล้ว`,
        contents: this.createTechnicianCompletionFlex({
          ...payload,
        }) as any,
      };

      await this.lineOAService.sendMessage(lineLink.lineUserId!, flexMessage);
      await this.saveNotificationLog(lineLink.lineUserId!, {
        type: 'REPAIR_TICKET_COMPLETED',
        title: 'ปิดงานสำเร็จ',
        message: `${payload.ticketCode}: ${payload.problemTitle}`,
      }, NotificationStatus.SENT);

      return { success: true };
    } catch (error) {
      this.logger.error(error.message);
      return { success: false };
    }
  }

  /* =======================
     NOTIFY TECHNICIAN (JOB CANCELLED)
  ====================== */

  async notifyTechnicianJobCancellation(
    technicianId: number,
    payload: {
      ticketCode: string;
      ticketId?: number;
      problemTitle: string;
      reporterName: string;
      department?: string;
      location?: string;
      cancelledAt: Date;
      cancelNote?: string;
      problemImageUrl?: string;
    }
  ) {
    try {
      const lineLink = await this.getVerifiedLineLink(technicianId);
      if (!lineLink) return { success: false, reason: 'Technician not linked to LINE' };

      const flexMessage = {
        type: 'flex' as const,
        altText: `ยกเลิกงานซ่อม ${payload.ticketCode}`,
        contents: this.createTechnicianCancellationFlex({
          ...payload,
        }) as any,
      };

      await this.lineOAService.sendMessage(lineLink.lineUserId!, flexMessage);
      await this.saveNotificationLog(lineLink.lineUserId!, {
        type: 'REPAIR_TICKET_CANCELLED',
        title: 'ยกเลิกงานซ่อม',
        message: `${payload.ticketCode}: ${payload.problemTitle}`,
      }, NotificationStatus.SENT);

      return { success: true };
    } catch (error) {
      this.logger.error(error.message);
      return { success: false };
    }
  }

  /* =======================
     NOTIFY TECHNICIAN (RUSH / REMINDER)
  ====================== */

  async notifyTechnicianRush(
    technicianId: number,
    payload: {
      ticketCode: string;
      ticketId?: number;
      problemTitle: string;
      rushMessage?: string;
      adminName?: string;
      reporterName: string;
      department?: string;
      location?: string;
      urgency: 'CRITICAL' | 'URGENT' | 'NORMAL';
      imageUrl?: string;
    }
  ) {
    try {
      const lineLink = await this.getVerifiedLineLink(technicianId);
      if (!lineLink) return { success: false, reason: 'Technician not linked to LINE' };

      const flexMessage = {
        type: 'flex' as const,
        altText: `⚡ เร่งงาน ${payload.ticketCode}`,
        contents: this.createTechnicianRushFlex(payload) as any,
      };

      await this.lineOAService.sendMessage(lineLink.lineUserId!, flexMessage);
      await this.saveNotificationLog(lineLink.lineUserId!, {
        type: 'REPAIR_TICKET_RUSH',
        title: 'เร่งงานซ่อม',
        message: `${payload.ticketCode}: ${payload.problemTitle}`,
      }, NotificationStatus.SENT);

      return { success: true };
    } catch (error) {
      this.logger.error(error.message);
      return { success: false };
    }
  }

  private createTechnicianRushFlex(payload: any) {
    const urgency = this.getUrgencyConfig(payload.urgency);

    const formattedDate = new Intl.DateTimeFormat('th-TH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(new Date());

    let frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    try {
      frontendUrl = new URL(frontendUrl).origin;
    } catch (e) {}

    const actionButtons: any[] = [];
    if (payload.ticketId) {
      actionButtons.push({
        type: 'button',
        action: { type: 'uri', label: 'จัดการงาน', uri: `${frontendUrl}/login/admin?ticketId=${payload.ticketId}` },
        style: 'primary',
        height: 'sm',
        color: '#2563EB',
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#DC2626',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              { type: 'text', text: '⚡ เร่งงานซ่อม', color: '#FFFFFF', weight: 'bold', size: 'lg', flex: 1 },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: urgency.color,
                cornerRadius: 'xl',
                paddingAll: '4px',
                paddingStart: '10px',
                paddingEnd: '10px',
                flex: 0,
                contents: [{ type: 'text', text: urgency.text, color: '#FFFFFF', size: 'xxs', weight: 'bold' }],
              },
            ],
          },
          { type: 'text', text: payload.ticketCode, color: '#FFFFFFCC', size: 'sm', margin: 'sm', weight: 'bold' },
        ],
      },
      hero: payload.imageUrl ? {
        type: 'image',
        url: payload.imageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      } : undefined,
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#FFFFFF',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xs', color: '#64748B', weight: 'bold' },
              { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: '#1E293B', wrap: true },
            ],
          },
          ...(payload.rushMessage ? [{
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#FEF2F2',
            cornerRadius: 'md',
            borderColor: '#FECACA',
            borderWidth: '1px',
            contents: [
              { type: 'text', text: `📌 ข้อความจากแอดมิน${payload.adminName ? ` (${payload.adminName})` : ''}`, size: 'xs', color: '#991B1B', weight: 'bold' },
              { type: 'text', text: payload.rushMessage, size: 'sm', color: '#7F1D1D', wrap: true, margin: 'xs' },
            ],
          }] : []),
          { type: 'separator', margin: 'xl', color: '#F1F5F9' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'xl',
            spacing: 'sm',
            contents: [
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'ผู้แจ้ง', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.reporterName, size: 'sm', color: '#1E293B', weight: 'bold', flex: 7, wrap: true },
                ],
              },
              ...(payload.department ? [{
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'แผนก', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.department, size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              }] : []),
              ...(payload.location ? [{
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'สถานที่', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.location, size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              }] : []),
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#F8FAFC',
        spacing: 'md',
        contents: [
          ...(actionButtons.length > 0 ? [{
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: actionButtons,
          }] : []),
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: formattedDate, size: 'xxs', color: '#94A3B8' },
              { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: '#CBD5E1', align: 'end', weight: 'bold' },
            ],
          },
        ],
      },
    };
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

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: statusConfig.color,
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'สถานะการแจ้งซ่อม', color: '#FFFFFFCC', size: 'xs', weight: 'bold', flex: 1 },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#FFFFFF33',
                cornerRadius: 'xl',
                paddingAll: '4px',
                paddingStart: '12px',
                paddingEnd: '12px',
                flex: 0,
                contents: [{ type: 'text', text: urgencyConfig.text, color: '#FFFFFF', size: 'xxs', weight: 'bold' }],
              },
            ],
          },
          { type: 'text', text: statusConfig.text, color: '#FFFFFF', size: 'xxl', weight: 'bold', margin: 'sm' },
        ],
      },
      hero: payload.imageUrl ? {
        type: 'image',
        url: payload.imageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      } : undefined,
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#FFFFFF',
        contents: [
          // ── Ticket Section ──
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'หมายเลขงาน', size: 'sm', color: '#64748B', flex: 4 },
              { type: 'text', text: payload.ticketCode, size: 'sm', color: '#1E293B', weight: 'bold', flex: 6, align: 'end' },
            ],
          },
          { type: 'separator', margin: 'lg', color: '#F1F5F9' },
          
          // ── Problem Section ──
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xs', color: '#64748B', weight: 'bold' },
              { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: '#1E293B', wrap: true },
            ],
          },

          // ── Description (Optional) ──
          ...(payload.description && payload.description !== payload.problemTitle ? [{
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#F8FAFC',
            cornerRadius: 'md',
            contents: [
              { type: 'text', text: 'รายละเอียด', size: 'xs', color: '#64748B', weight: 'bold' },
              { type: 'text', text: payload.description, size: 'sm', color: '#334155', wrap: true, margin: 'xs' },
            ],
          }] : []),

          // ── Remark (Optional) ──
          ...(payload.remark ? [{
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            backgroundColor: '#FFF7ED',
            cornerRadius: 'md',
            paddingAll: '12px',
            borderColor: '#FED7AA',
            borderWidth: '1px',
            contents: [
              { type: 'text', text: 'แจ้งจากเจ้าหน้าที่', size: 'xs', color: '#9A3412', weight: 'bold' },
              { type: 'text', text: payload.remark, size: 'sm', color: '#7C2D12', wrap: true, margin: 'xs' },
            ],
          }] : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: '#F8FAFC',
        paddingAll: '16px',
        justifyContent: 'space-between',
        contents: [
          { type: 'text', text: `แจ้งเมื่อ ${formattedDate}`, size: 'xxs', color: '#94A3B8' },
          { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: '#CBD5E1', weight: 'bold', align: 'end' },
        ],
      },
    };
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

    // Build action buttons
    let frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    try {
      frontendUrl = new URL(frontendUrl).origin;
    } catch (e) {}
    
    const actionButtons: any[] = [];
    if (payload.reporterPhone) {
      actionButtons.push({
        type: 'button',
        action: { type: 'uri', label: 'โทรหาผู้แจ้ง', uri: `tel:${payload.reporterPhone}` },
        style: 'primary',
        height: 'sm',
        color: '#63DC75',
      });
    }
    if (payload.ticketId) {
      actionButtons.push({
        type: 'button',
        action: { type: 'uri', label: 'จัดการงาน', uri: `${frontendUrl}/login/admin?ticketId=${payload.ticketId}` },
        style: 'primary',
        height: 'sm',
        color: '#2563EB',
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLORS.HEADER_DARK,
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'แจ้งซ่อมใหม่', color: '#FFFFFF', weight: 'bold', size: 'lg', flex: 1 },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: urgency.color,
                cornerRadius: 'xl',
                paddingAll: '4px',
                paddingStart: '10px',
                paddingEnd: '10px',
                flex: 0,
                contents: [{ type: 'text', text: urgency.text, color: '#FFFFFF', size: 'xxs', weight: 'bold' }],
              },
            ],
          },
          { type: 'text', text: payload.ticketCode, color: '#94A3B8', size: 'sm', margin: 'sm', weight: 'bold' },
        ],
      },
      hero: payload.imageUrl ? {
        type: 'image',
        url: payload.imageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      } : undefined,
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#FFFFFF',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xs', color: '#64748B', weight: 'bold' },
              { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: '#1E293B', wrap: true },
            ],
          },
          ...(payload.problemDescription ? [{
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#F8FAFC',
            cornerRadius: 'md',
            contents: [
              { type: 'text', text: 'รายละเอียด', size: 'xs', color: '#64748B', weight: 'bold' },
              { type: 'text', text: payload.problemDescription, size: 'sm', color: '#334155', wrap: true, margin: 'xs' },
            ],
          }] : []),
          { type: 'separator', margin: 'xl', color: '#F1F5F9' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'xl',
            spacing: 'sm',
            contents: [
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'ผู้แจ้ง', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.reporterName, size: 'sm', color: '#1E293B', weight: 'bold', flex: 7, wrap: true },
                ],
              },
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'แผนก', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.department, size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              },
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'สถานที่', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.location, size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#F8FAFC',
        spacing: 'md',
        contents: [
          ...(actionButtons.length > 0 ? [{
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: actionButtons,
          }] : []),
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: formattedDate, size: 'xxs', color: '#94A3B8' },
              { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: '#CBD5E1', align: 'end', weight: 'bold' },
            ],
          },
        ],
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

    let frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    try {
      frontendUrl = new URL(frontendUrl).origin;
    } catch (e) {}

    const actionButtons: any[] = [];
    if (payload.reporterPhone) {
      actionButtons.push({
        type: 'button',
        action: { type: 'uri', label: 'โทรหาผู้แจ้ง', uri: `tel:${payload.reporterPhone}` },
        style: 'primary',
        height: 'sm',
        color: '#63DC75',
      });
    }
    if (payload.ticketId) {
      actionButtons.push({
        type: 'button',
        action: { type: 'uri', label: 'จัดการงาน', uri: `${frontendUrl}/login/admin?ticketId=${payload.ticketId}` },
        style: 'primary',
        height: 'sm',
        color: '#2563EB',
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLORS.HEADER_DARK,
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              { type: 'text', text: actionText, color: '#FFFFFF', weight: 'bold', size: 'lg', flex: 1, wrap: true },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: urgency.color,
                cornerRadius: 'xl',
                paddingAll: '4px',
                paddingStart: '10px',
                paddingEnd: '10px',
                flex: 0,
                contents: [{ type: 'text', text: urgency.text, color: '#FFFFFF', size: 'xxs', weight: 'bold' }],
              },
            ],
          },
          { type: 'text', text: payload.ticketCode, color: '#94A3B8', size: 'sm', margin: 'sm', weight: 'bold' },
        ],
      },
      hero: payload.imageUrl ? {
        type: 'image',
        url: payload.imageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      } : undefined,
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#FFFFFF',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xs', color: '#64748B', weight: 'bold' },
              { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: '#1E293B', wrap: true },
            ],
          },
          ...(payload.adminNote ? [{
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#FFF7ED',
            cornerRadius: 'md',
            borderColor: '#FED7AA',
            borderWidth: '1px',
            contents: [
              { type: 'text', text: 'หมายเหตุจากแอดมิน', size: 'xs', color: '#9A3412', weight: 'bold' },
              { type: 'text', text: payload.adminNote, size: 'sm', color: '#7C2D12', wrap: true, margin: 'xs' },
            ],
          }] : []),
          { type: 'separator', margin: 'xl', color: '#F1F5F9' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'xl',
            spacing: 'sm',
            contents: [
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'ผู้แจ้ง', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.reporterName, size: 'sm', color: '#1E293B', weight: 'bold', flex: 7, wrap: true },
                ],
              },
              ...(payload.department ? [{
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'แผนก', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.department, size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              }] : []),
              ...(payload.location ? [{
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'สถานที่', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.location, size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              }] : []),
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#F8FAFC',
        spacing: 'md',
        contents: [
          ...(actionButtons.length > 0 ? [{
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: actionButtons,
          }] : []),
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: formattedDate, size: 'xxs', color: '#94A3B8' },
              { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: '#CBD5E1', align: 'end', weight: 'bold' },
            ],
          },
        ],
      },
    };
  }

  private createTechnicianCompletionFlex(payload: any) {
    const formattedDate = new Intl.DateTimeFormat('th-TH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(payload.completedAt || new Date());

    let frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    try {
      frontendUrl = new URL(frontendUrl).origin;
    } catch (e) {}
    
    const actionButtons: any[] = [];
    if (payload.ticketId) {
      actionButtons.push({
        type: 'button',
        action: { type: 'uri', label: 'ดูรายละเอียดงาน', uri: `${frontendUrl}/login/admin?ticketId=${payload.ticketId}` },
        style: 'primary',
        height: 'sm',
        color: '#059669',
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#059669',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'ปิดงานเรียบร้อย', color: '#FFFFFF', weight: 'bold', size: 'lg', flex: 1, wrap: true },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#DCFCE7',
                cornerRadius: 'xl',
                paddingAll: '4px',
                paddingStart: '10px',
                paddingEnd: '10px',
                flex: 0,
                contents: [{ type: 'text', text: 'เสร็จสิ้น', color: '#166534', size: 'xxs', weight: 'bold' }],
              },
            ],
          },
          { type: 'text', text: payload.ticketCode, color: '#DCFCE7CC', size: 'sm', margin: 'sm', weight: 'bold' },
        ],
      },
      hero: payload.problemImageUrl ? {
        type: 'image',
        url: payload.problemImageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      } : undefined,
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#FFFFFF',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'งานซ่อม', size: 'xs', color: '#64748B', weight: 'bold' },
              { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: '#1E293B', wrap: true },
            ],
          },
          ...(payload.completionNote ? [{
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#F0FDF4',
            cornerRadius: 'md',
            borderColor: '#BBF7D0',
            borderWidth: '1px',
            contents: [
              { type: 'text', text: 'สรุปการปิดงาน', size: 'xs', color: '#15803D', weight: 'bold' },
              { type: 'text', text: payload.completionNote, size: 'sm', color: '#166534', wrap: true, margin: 'xs' },
            ],
          }] : []),
          { type: 'separator', margin: 'xl', color: '#F1F5F9' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'xl',
            spacing: 'sm',
            contents: [
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'ผู้แจ้ง', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.reporterName, size: 'sm', color: '#1E293B', weight: 'bold', flex: 7, wrap: true },
                ],
              },
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'แผนก', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.department || '-', size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              },
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'สถานที่', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.location || '-', size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#F8FAFC',
        spacing: 'md',
        contents: [
          ...(actionButtons.length > 0 ? [{
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: actionButtons,
          }] : []),
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: `ปิดงานเมื่อ ${formattedDate}`, size: 'xxs', color: '#94A3B8' },
              { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: '#CBD5E1', align: 'end', weight: 'bold' },
            ],
          },
        ],
      },
    };
  }

  private createTechnicianCancellationFlex(payload: any) {
    const formattedDate = new Intl.DateTimeFormat('th-TH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    }).format(payload.cancelledAt || new Date());

    let frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    try {
      frontendUrl = new URL(frontendUrl).origin;
    } catch (e) {}
    
    const actionButtons: any[] = [];
    if (payload.ticketId) {
      actionButtons.push({
        type: 'button',
        action: { type: 'uri', label: 'ดูรายละเอียดงาน', uri: `${frontendUrl}/login/admin?ticketId=${payload.ticketId}` },
        style: 'primary',
        height: 'sm',
        color: '#DC2626',
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#DC2626',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'ยกเลิกงานซ่อม', color: '#FFFFFF', weight: 'bold', size: 'lg', flex: 1, wrap: true },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#FEE2E2',
                cornerRadius: 'xl',
                paddingAll: '4px',
                paddingStart: '10px',
                paddingEnd: '10px',
                flex: 0,
                contents: [{ type: 'text', text: 'ยกเลิก', color: '#991B1B', size: 'xxs', weight: 'bold' }],
              },
            ],
          },
          { type: 'text', text: payload.ticketCode, color: '#FEE2E2CC', size: 'sm', margin: 'sm', weight: 'bold' },
        ],
      },
      hero: payload.problemImageUrl ? {
        type: 'image',
        url: payload.problemImageUrl,
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      } : undefined,
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#FFFFFF',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'งานซ่อม', size: 'xs', color: '#64748B', weight: 'bold' },
              { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: '#1E293B', wrap: true },
            ],
          },
          ...(payload.cancelNote ? [{
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: '#FEF2F2',
            cornerRadius: 'md',
            borderColor: '#FECACA',
            borderWidth: '1px',
            contents: [
              { type: 'text', text: 'เหตุผลการยกเลิก', size: 'xs', color: '#B91C1C', weight: 'bold' },
              { type: 'text', text: payload.cancelNote, size: 'sm', color: '#991B1B', wrap: true, margin: 'xs' },
            ],
          }] : []),
          { type: 'separator', margin: 'xl', color: '#F1F5F9' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'xl',
            spacing: 'sm',
            contents: [
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'ผู้แจ้ง', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.reporterName, size: 'sm', color: '#1E293B', weight: 'bold', flex: 7, wrap: true },
                ],
              },
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'แผนก', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.department || '-', size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              },
              {
                type: 'box', layout: 'horizontal', contents: [
                  { type: 'text', text: 'สถานที่', size: 'sm', color: '#64748B', flex: 3 },
                  { type: 'text', text: payload.location || '-', size: 'sm', color: '#1E293B', flex: 7, wrap: true },
                ],
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#F8FAFC',
        spacing: 'md',
        contents: [
          ...(actionButtons.length > 0 ? [{
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: actionButtons,
          }] : []),
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: `ยกเลิกเมื่อ ${formattedDate}`, size: 'xxs', color: '#94A3B8' },
              { type: 'text', text: 'ระบบแจ้งซ่อม', size: 'xxs', color: '#CBD5E1', align: 'end', weight: 'bold' },
            ],
          },
        ],
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

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: config.color,
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'อัปเดตสถานะงาน',
            color: '#FFFFFFCC',
            size: 'xs',
            weight: 'bold',
          },
          {
            type: 'text',
            text: config.text,
            color: '#FFFFFF',
            size: 'xxl',
            weight: 'bold',
            margin: 'sm',
            wrap: true,
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFFFFF',
        paddingAll: '20px',
        contents: [
          // ── Ticket Section ──
          {
            type: 'box',
            layout: 'horizontal',
            justifyContent: 'space-between',
            alignItems: 'center',
            contents: [
              {
                type: 'text',
                text: 'หมายเลขงาน',
                color: '#94A3B8',
                size: 'xs',
                weight: 'bold',
              },
              {
                type: 'text',
                text: payload.ticketCode,
                color: '#1E293B',
                size: 'md',
                weight: 'bold',
                align: 'end',
              },
            ],
          },
          {
            type: 'separator',
            margin: 'lg',
            color: '#F1F5F9',
          },

          // ── Problem Section ──
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: 'แจ้งเรื่อง',
                color: '#94A3B8',
                size: 'xs',
                weight: 'bold',
              },
              {
                type: 'text',
                text: payload.problemTitle || '-',
                color: '#1E293B',
                size: 'sm',
                weight: 'regular',
                wrap: true,
              },
            ],
          },

          // ── Technician Section ──
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: 'ผู้รับผิดชอบ',
                color: '#94A3B8',
                size: 'xs',
                weight: 'bold',
              },
              {
                type: 'text',
                text: hasTechnician
                  ? payload.technicianNames!.join(', ')
                  : 'กำลังตรวจสอบ',
                color: hasTechnician ? '#1E293B' : '#F59E0B',
                size: 'sm',
                weight: 'regular',
                wrap: true,
              },
            ],
          },

          // ── Remark Section (Optional) ──
          ...(payload.remark
            ? [
                {
                  type: 'box',
                  layout: 'vertical',
                  margin: 'lg',
                  backgroundColor: '#FFF7ED',
                  cornerRadius: 'md',
                  paddingAll: '12px',
                  borderColor: '#FED7AA',
                  borderWidth: '1px',
                  contents: [
                    {
                      type: 'text',
                      text: 'หมายเหตุเพิ่มเติม',
                      color: '#9A3412',
                      size: 'xs',
                      weight: 'bold',
                    },
                    {
                      type: 'text',
                      text: payload.remark,
                      color: '#7C2D12',
                      size: 'sm',
                      wrap: true,
                      margin: 'xs',
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: '#F8FAFC',
        paddingAll: '16px',
        justifyContent: 'space-between',
        contents: [
          {
            type: 'text',
            text: formattedDate,
            color: '#94A3B8',
            size: 'xxs',
          },
          {
            type: 'text',
            text: 'ระบบแจ้งซ่อม',
            color: '#CBD5E1',
            size: 'xxs',
            weight: 'bold',
            align: 'end',
          },
        ],
      },
      styles: {
        footer: {
          separator: false,
        },
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

  /* =======================
     CHECK STATUS FLEX (PRODUCTION CARD STYLE)
  ======================= */

  /**
   * สร้าง Flex Message แบบ Card "ประวัติการแจ้งซ่อม"
   * ออกแบบให้สะอาดตา (Minimalist) และดูเป็นมืออาชีพ (Production-grade)
   * เน้นการใช้อินเตอร์เฟซที่สะอาด (Whitespace) และสีที่สดใสในจุดที่จำเป็น
   */
  createCheckStatusCarousel(tickets: any[], page = 1, pageSize = 3): any {
    let frontendUrl = process.env.FRONTEND_URL || 'https://qa-rp-trr-ku-csc.vercel.app';
    try { frontendUrl = new URL(frontendUrl).origin; } catch (e) {}

    const totalTickets = tickets.length;
    const totalPages = Math.max(Math.ceil(totalTickets / pageSize), 1);
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const startIdx = (currentPage - 1) * pageSize;
    const displayTickets = tickets.slice(startIdx, startIdx + pageSize);

    // สีหลักสำหรับความเร่งด่วน (ใช้เป็นแถบ Accent ด้านข้าง)
    const urgencyThemes: Record<string, { color: string; label: string }> = {
      NORMAL:   { color: '#10B981', label: 'ปกติ' },      // Green
      URGENT:   { color: '#F59E0B', label: 'ด่วน' },       // Amber
      CRITICAL: { color: '#EF4444', label: 'ด่วนที่สุด' }, // Red
    };

    const ticketCards: any[] = [];
    displayTickets.forEach((ticket) => {
      const statusCfg = this.getStatusConfig(ticket.status);
      const theme = urgencyThemes[ticket.urgency] || urgencyThemes.NORMAL;
      const dateStr = new Intl.DateTimeFormat('th-TH', {
        day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok',
      }).format(new Date(ticket.createdAt));

      ticketCards.push({
        type: 'box',
        layout: 'horizontal',
        backgroundColor: '#FFFFFF',
        cornerRadius: 'xl',
        borderWidth: '1px',
        borderColor: '#F1F5F9',
        margin: 'md',
        paddingAll: '0px',
        contents: [
          // ── แถบ Accent สีความเร่งด่วน (ซ้าย) ──
          {
            type: 'box',
            layout: 'vertical',
            width: '6px',
            backgroundColor: theme.color,
            contents: [{ type: 'filler' }],
          },
          // ── เนื้อหาหลัก ──
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            paddingAll: '16px',
            spacing: 'xs',
            contents: [
              // ด้านบน: หัวข้อ + วันที่
              {
                type: 'box',
                layout: 'horizontal',
                alignItems: 'center',
                contents: [
                  { 
                    type: 'text', 
                    text: ticket.ticketCode, 
                    size: 'xxs', 
                    color: '#94A3B8', 
                    weight: 'bold',
                    flex: 1 
                  },
                  { 
                    type: 'text', 
                    text: dateStr, 
                    size: 'xxs', 
                    color: '#94A3B8', 
                    align: 'end',
                    flex: 0 
                  },
                ],
              },
              // ปัญหา (เด่นที่สุด)
              {
                type: 'text',
                text: ticket.problemTitle,
                size: 'sm',
                color: '#1E293B',
                weight: 'bold',
                wrap: true,
                maxLines: 2,
                margin: 'xs'
              },
              // ด้านล่าง: Badge สถานะ + ปุ่ม
              {
                type: 'box',
                layout: 'horizontal',
                alignItems: 'center',
                margin: 'md',
                contents: [
                  // Badge สถานะแบบโค้งมน สีพื้นโปร่งแสง
                  {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: statusCfg.color + '15',
                    cornerRadius: 'xl',
                    paddingAll: '4px',
                    paddingStart: '12px',
                    paddingEnd: '12px',
                    flex: 0,
                    contents: [
                      { 
                        type: 'text', 
                        text: statusCfg.text, 
                        color: statusCfg.color, 
                        size: 'xxs', 
                        weight: 'bold' 
                      }
                    ],
                  },
                  { type: 'filler' },
                  // ปุ่ม "ดูข้อมูล" แบบเรียบหรู
                  {
                    type: 'text',
                    text: 'ดูข้อมูล ›',
                    size: 'xs',
                    color: '#3B82F6',
                    weight: 'bold',
                    align: 'end',
                    action: {
                      type: 'uri',
                      uri: `${frontendUrl}/repairs/track/${ticket.ticketCode}`,
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    // ── Pagination Styling (Modern) ──
    const pagination: any[] = [{ type: 'filler' }];
    
    // Page count indicator
    pagination.push({
      type: 'text',
      text: `หน้า ${currentPage} จาก ${totalPages}`,
      size: 'xxs',
      color: '#94A3B8',
      flex: 0,
      gravity: 'center'
    });

    // Navigation buttons
    if (currentPage > 1) {
      pagination.push({
        type: 'button',
        action: {
          type: 'postback',
          label: 'ก่อนหน้า',
          data: `action=check_status&page=${currentPage - 1}`,
          displayText: `ไปหน้าที่ ${currentPage - 1}`,
        },
        style: 'link',
        height: 'sm',
        flex: 0,
      });
    }

    if (currentPage < totalPages) {
      pagination.push({
        type: 'button',
        action: {
          type: 'postback',
          label: 'ถัดไป',
          data: `action=check_status&page=${currentPage + 1}`,
          displayText: `ไปหน้าที่ ${currentPage + 1}`,
        },
        style: 'link',
        height: 'sm',
        flex: 0,
      });
    }

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFFFFF',
        paddingAll: '20px',
        paddingBottom: '10px',
        contents: [
          {
            type: 'text',
            text: 'รายการแจ้งซ่อมของคุณ',
            color: '#0F172A',
            size: 'lg',
            weight: 'bold',
          },
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: `พบทั้งหมด ${totalTickets} รายการ`, color: '#64748B', size: 'xs', flex: 1 },
              { type: 'text', text: 'ล่าสุด', color: '#10B981', size: 'xs', weight: 'bold', align: 'end', flex: 0 },
            ]
          },
          {
            type: 'separator',
            margin: 'md',
            color: '#F1F5F9'
          }
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        paddingTop: '0px',
        backgroundColor: '#FFFFFF',
        contents: [...ticketCards],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        paddingAll: '12px',
        backgroundColor: '#FFFFFF',
        spacing: 'sm',
        alignItems: 'center',
        contents: pagination,
      },
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
      PENDING: { color: COLORS.INFO, text: 'รอดำเนินการ' },
      ASSIGNED: { color: COLORS.INFO, text: 'มอบหมายแล้ว' },
      IN_PROGRESS: { color: COLORS.WARNING, text: 'กำลังดำเนินการ' },
      COMPLETED: { color: COLORS.SUCCESS, text: 'เสร็จสิ้น' },
      CANCELLED: { color: '#EF4444', text: 'ยกเลิก' },
    }[status] || { color: COLORS.PRIMARY, text: status });
  }
}
