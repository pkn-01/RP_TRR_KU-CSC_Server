import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LineOAService } from './line-oa.service';
import { LineNotificationStatus } from '@prisma/client';

/* =======================
   ENUMS & CONSTANTS
======================= */

const NotificationStatus = LineNotificationStatus;

const COLORS = {
  CRITICAL: '#D32F2F',
  URGENT: '#F57C00',
  NORMAL: '#2E7D32',
  SUCCESS: '#2ECC71',
  INFO: '#3498DB',
  WARNING: '#F39C12',
  SECONDARY: '#95A5A6',
  PRIMARY: '#34495E',
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
  reporterName: string;
  department: string;
  problemTitle: string;
  problemDescription?: string;
  location: string;
  urgency: 'CRITICAL' | 'URGENT' | 'NORMAL';
  createdAt: string;
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
      problemTitle: string;
      reporterName: string;
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

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: urgency.color,
        paddingAll: '15px',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            contents: [
              { type: 'text', text: 'รายงานแจ้งซ่อมใหม่', color: '#FFFFFF', weight: 'bold', size: 'md' },
              { type: 'text', text: payload.ticketCode, color: '#FFFFFF', size: 'xs', margin: 'xs' },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#FFFFFF33',
            cornerRadius: 'md',
            paddingAll: '4px',
            paddingStart: '8px',
            paddingEnd: '8px',
            justifyContent: 'center',
            contents: [{ type: 'text', text: urgency.text, color: '#FFFFFF', size: 'xxs', weight: 'bold' }]
          }
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xs', color: '#94A3B8' },
              { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: '#1F2937', wrap: true },
            ],
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F8FAFC',
            paddingAll: '12px',
            cornerRadius: 'md',
            spacing: 'xs',
            contents: [
              {
                type: 'box', layout: 'horizontal', spacing: 'sm',
                contents: [
                  { type: 'text', text: 'ผู้แจ้ง:', size: 'xs', color: '#64748B', flex: 2 },
                  { type: 'text', text: payload.reporterName, size: 'xs', color: '#334155', weight: 'bold', flex: 5 }
                ]
              },
              {
                type: 'box', layout: 'horizontal', spacing: 'sm',
                contents: [
                  { type: 'text', text: 'แผนก:', size: 'xs', color: '#64748B', flex: 2 },
                  { type: 'text', text: payload.department, size: 'xs', color: '#334155', flex: 5 }
                ]
              },
              {
                type: 'box', layout: 'horizontal', spacing: 'sm',
                contents: [
                  { type: 'text', text: 'สถานที่:', size: 'xs', color: '#64748B', flex: 2 },
                  { type: 'text', text: payload.location, size: 'xs', color: '#334155', flex: 5 }
                ]
              }
            ]
          }
        ],
      },
    };
  }

  private createTechnicianAssignmentFlex(payload: any, actionText: string) {
    const urgency = this.getUrgencyConfig(payload.urgency);

    return {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#111827',
        paddingAll: '15px',
        contents: [
          { type: 'text', text: `${actionText}`, color: '#FFFFFF', weight: 'bold', size: 'md' },
          { type: 'text', text: payload.ticketCode, color: '#FFFFFF', size: 'xs', margin: 'xs', opacity: '0.7' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            justifyContent: 'space-between',
            alignItems: 'center',
            contents: [
              { type: 'text', text: '🔧 รายละเอียดงาน', size: 'xs', color: '#94A3B8' },
              {
                type: 'box', layout: 'vertical', backgroundColor: urgency.color + '20',
                paddingAll: '2px', paddingStart: '8px', paddingEnd: '8px', cornerRadius: 'md',
                contents: [{ type: 'text', text: urgency.text, color: urgency.color, size: '10px', weight: 'bold' }]
              }
            ]
          },
          { type: 'text', text: payload.problemTitle, weight: 'bold', size: 'md', color: '#1F2937', wrap: true },
          { type: 'separator', margin: 'sm' },
          {
            type: 'box', layout: 'vertical', spacing: 'xs',
            contents: [
              {
                type: 'box', layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'ผู้แจ้ง:', size: 'xs', color: '#64748B', flex: 2 },
                  { type: 'text', text: payload.reporterName, size: 'xs', color: '#334155', flex: 5 }
                ]
              },
            ]
          }
        ],
      },
    };
  }

  private createStatusUpdateFlex(payload: RepairStatusUpdatePayload) {
    const config = this.getStatusConfig(payload.status);
    
    const formattedDate = new Intl.DateTimeFormat('th-TH', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', 
      timeZone: 'Asia/Bangkok',
    }).format(payload.updatedAt || new Date());

    return {
      type: 'bubble',
      size: 'mega',
      // Header - Compact Status Banner
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: config.color,
        paddingAll: '15px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            contents: [
              { 
                type: 'text', 
                text: `${config.text}`, 
                color: '#FFFFFF', 
                weight: 'bold', 
                size: 'lg' 
              },
              { 
                type: 'text', 
                text: payload.ticketCode, 
                color: '#FFFFFF', 
                size: 'xs', 
                margin: 'xs',
                decoration: 'none'
              },
            ],
          },
        ],
      },
      // Body - Clean Information Layout
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        backgroundColor: '#FFFFFF',
        contents: [
          // Problem Title
          ...(payload.problemTitle ? [{
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              { type: 'text', text: 'ปัญหาที่แจ้ง', size: 'xs', color: '#94A3B8' },
              { type: 'text', text: payload.problemTitle, size: 'md', weight: 'bold', color: '#1F2937', wrap: true },
            ],
          }] : []),
          // Technician Info
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            alignItems: 'center',
            paddingTop: '12px',
            paddingBottom: '12px',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                width: '36px',
                height: '36px',
                backgroundColor: payload.technicianNames && payload.technicianNames.length > 0 ? '#10B981' : '#F59E0B',
                cornerRadius: 'xxl',
                justifyContent: 'center',
                alignItems: 'center',
                contents: [
                  { type: 'text', text: payload.technicianNames && payload.technicianNames.length > 0 ? '👨‍🔧' : '⏳', size: 'md' }
                ],
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: 'ผู้รับผิดชอบ', size: 'xxs', color: '#94A3B8' },
                  { 
                    type: 'text', 
                    text: payload.technicianNames && payload.technicianNames.length > 0 
                      ? payload.technicianNames.join(', ') 
                      : 'รอมอบหมาย', 
                    size: 'sm', 
                    weight: 'bold', 
                    color: payload.technicianNames && payload.technicianNames.length > 0 ? '#059669' : '#D97706',
                    wrap: true
                  },
                ],
              },
            ],
          },
          // Remark (if any)
          ...(payload.remark ? [{
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F9FAFB',
            cornerRadius: 'md',
            paddingAll: '12px',
            contents: [
              { type: 'text', text: 'หมายเหตุ', size: 'xxs', color: '#6B7280' },
              { type: 'text', text: payload.remark, size: 'sm', color: '#374151', wrap: true, margin: 'xs' },
            ],
          }] : []),
          // Timestamp
          {
            type: 'box',
            layout: 'horizontal',
            justifyContent: 'flex-end',
            contents: [
              { type: 'text', text: `อัปเดต: ${formattedDate}`, size: 'xxs', color: '#9CA3AF' },
            ],
          },
        ],
      },
    };
  }

  private createFlexRow(label: string, value: string, bold = false) {
    return {
      type: 'box', layout: 'baseline',
      contents: [
        { type: 'text', text: label, size: 'sm', color: '#AAAAAA', flex: 2 },
        { type: 'text', text: value, size: 'sm', wrap: true, flex: 5, weight: bold ? 'bold' : 'regular' },
      ],
    };
  }

  private getUrgencyConfig(level: string) {
    return ({
      CRITICAL: { color: COLORS.CRITICAL, text: 'ด่วนที่สุด' },
      URGENT: { color: COLORS.URGENT, text: 'ด่วน' },
      NORMAL: { color: COLORS.NORMAL, text: 'ปกติ' },
    }[level] || { color: COLORS.NORMAL, text: 'ปกติ' });
  }

  private getStatusConfig(status: string) {
    return ({
      PENDING: { color: COLORS.WARNING, text: 'รอดำเนินการ' },
      ASSIGNED: { color: COLORS.INFO, text: 'มอบหมายแล้ว' },
      IN_PROGRESS: { color: COLORS.INFO, text: 'กำลังดำเนินการ' },
      COMPLETED: { color: COLORS.SUCCESS, text: 'เสร็จสิ้น' },
      WAITING_USER: { color: COLORS.WARNING, text: 'รอข้อมูลจากผู้แจ้ง' },
      CANCELLED: { color: COLORS.SECONDARY, text: 'ยกเลิก' },
    }[status] || { color: COLORS.PRIMARY, text: status });
  }
}
