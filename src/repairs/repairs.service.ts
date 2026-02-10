import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RepairTicketStatus, UrgencyLevel } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { LineOANotificationService } from '../line-oa/line-oa-notification.service';
import * as path from 'path';

// Security: Allowed file types and size limits
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

@Injectable()
export class RepairsService {
  private readonly logger = new Logger(RepairsService.name);

  // Valid status transitions
  private readonly statusTransitions: Record<RepairTicketStatus, RepairTicketStatus[]> = {
    [RepairTicketStatus.PENDING]: [RepairTicketStatus.ASSIGNED, RepairTicketStatus.IN_PROGRESS, RepairTicketStatus.CANCELLED],
    [RepairTicketStatus.ASSIGNED]: [RepairTicketStatus.PENDING, RepairTicketStatus.IN_PROGRESS, RepairTicketStatus.CANCELLED],
    [RepairTicketStatus.IN_PROGRESS]: [RepairTicketStatus.WAITING_PARTS, RepairTicketStatus.COMPLETED, RepairTicketStatus.CANCELLED],
    [RepairTicketStatus.WAITING_PARTS]: [RepairTicketStatus.IN_PROGRESS, RepairTicketStatus.COMPLETED, RepairTicketStatus.CANCELLED],
    [RepairTicketStatus.COMPLETED]: [],
    [RepairTicketStatus.CANCELLED]: [],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly lineNotificationService: LineOANotificationService,
  ) {}

  /**
   * Validate if a status transition is allowed
   */
  private validateStatusTransition(from: RepairTicketStatus, to: RepairTicketStatus): boolean {
    if (from === to) return true; // Same status is always valid
    return this.statusTransitions[from]?.includes(to) || false;
  }

  /**
   * Sanitize filename to prevent path traversal attacks
   */
  private sanitizeFilename(filename: string): string {
    const basename = path.basename(filename);
    return basename.replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  /**
   * Generate random code for LINE OA linking
   */
  private generateRandomCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async create(userId: number, dto: any, files?: Express.Multer.File[], lineUserId?: string) {
    // Debug logging
    this.logger.log(`Creating ticket - lineUserId parameter: ${lineUserId || 'NOT PROVIDED'}`);
    
    const ticketCode = `REP-${Date.now()}`;
    // Generate unique linking code for LINE OA (for guest users who didn't come from LINE)
    // Only needed if lineUserId is not provided
    const linkingCode = lineUserId ? undefined : `${ticketCode}-${this.generateRandomCode(4)}`;
    
    const attachmentData: any[] = [];

    // Upload files to Cloudinary with security validations
    if (files && files.length > 0) {
      for (const file of files) {
        try {
          // SECURITY: Validate MIME type
          if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            this.logger.warn(`Rejected file with invalid MIME type: ${file.mimetype}`);
            throw new BadRequestException(`Invalid file type: ${file.mimetype}. Only images are allowed.`);
          }

          // SECURITY: Validate file size
          if (file.size > MAX_FILE_SIZE) {
            this.logger.warn(`Rejected file exceeding size limit: ${file.size} bytes`);
            throw new BadRequestException(`File size exceeds 5MB limit`);
          }

          // SECURITY: Sanitize filename
          const sanitizedName = this.sanitizeFilename(file.originalname);

          const result = await this.cloudinaryService.uploadFile(
            file.buffer,
            sanitizedName,
            'repairs', // Cloudinary folder
          );

          attachmentData.push({
            filename: sanitizedName,
            fileUrl: result.url,
            fileSize: file.size,
            mimeType: file.mimetype,
          });
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw error; // Re-throw validation errors
          }
          this.logger.error(`Failed to upload file ${file.originalname}:`, error);
          // Continue with other files even if one fails
        }
      }
    }

    const ticket = await this.prisma.repairTicket.create({
      data: {
        ticketCode,
        linkingCode, // For LINE OA linking (only for guest users)
        reporterLineUserId: lineUserId || null, // Direct LINE notification (for LINE OA users)
        reporterName: dto.reporterName,
        reporterDepartment: dto.reporterDepartment || null,
        reporterPhone: dto.reporterPhone || null,
        reporterLineId: dto.reporterLineId || null,
        problemCategory: dto.problemCategory,
        problemTitle: dto.problemTitle,
        problemDescription: dto.problemDescription || null,
        location: dto.location,
        urgency: dto.urgency || UrgencyLevel.NORMAL,
        userId,
        notes: dto.notes || null,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : new Date(),
        attachments: {
          create: attachmentData,
        },
      },
    });

    // 🔔 Notify IT team via LINE when new ticket is created
    try {
      await this.lineNotificationService.notifyRepairTicketToITTeam({
        ticketCode: ticket.ticketCode,
        reporterName: dto.reporterName,
        department: dto.reporterDepartment || 'ไม่ระบุแผนก',
        problemTitle: dto.problemTitle,
        problemDescription: dto.problemDescription,
        location: dto.location,
        urgency: dto.urgency || 'NORMAL',
        createdAt: new Date().toISOString(),
      });
      this.logger.log(`LINE notification sent for new ticket to IT Team: ${ticket.ticketCode}`);
    } catch (error) {
      // Don't fail the ticket creation if notification fails
      this.logger.error('Failed to send LINE notification to IT Team:', error);
    }

    // 🔔 Notify REPORTER via LINE when new ticket is created
    try {
      const imageUrl = attachmentData.length > 0 ? attachmentData[0].fileUrl : undefined;

      if (lineUserId) {
        // Direct notification for guest users (LIFF)
        await this.lineNotificationService.notifyReporterDirectly(lineUserId, {
          ticketCode: ticket.ticketCode,
          status: ticket.status,
          urgency: ticket.urgency as 'CRITICAL' | 'URGENT' | 'NORMAL',
          problemTitle: ticket.problemTitle,
          description: ticket.problemDescription || ticket.problemTitle,
          imageUrl,
          createdAt: ticket.createdAt,
          // remark: 'ได้รับเรื่องแจ้งซ่อมของคุณแล้ว ระบบจะแจ้งเตือนเมื่อมีการอัปเดตสถานะ',
        });
        this.logger.log(`LINE notification sent directly to reporter: ${lineUserId}`);
      } else if (userId) {
        // Notification for logged-in users
        await this.lineNotificationService.notifyRepairTicketStatusUpdate(userId, {
          ticketCode: ticket.ticketCode,
          problemTitle: ticket.problemTitle,
          status: ticket.status,
          // remark: 'ได้รับเรื่องแจ้งซ่อมของคุณแล้ว ระบบจะแจ้งเตือนเมื่อมีความคืบหน้า',
          technicianNames: [],
          updatedAt: ticket.createdAt,
        });
        this.logger.log(`LINE notification sent to user ${userId} for new ticket`);
      }
    } catch (error) {
      // Don't fail the ticket creation if notification fails
      this.logger.error('Failed to send reporter LINE notification:', error);
    }

    return ticket;
  }

  async findOne(id: number) {
    const ticket = await this.prisma.repairTicket.findUnique({
      where: { id },
      include: {
        user: true,
        assignees: { include: { user: true } },
        attachments: true,
        logs: { include: { user: true }, orderBy: { createdAt: 'desc' } },
        assignmentHistory: {
          include: { 
            assigner: true,
            assignee: true
          },
          orderBy: { createdAt: 'desc' }
        }
      },
    });
    if (!ticket) throw new NotFoundException(`Repair ticket #${id} not found`);
    return ticket;
  }

  async findByCode(ticketCode: string) {
    const ticket = await this.prisma.repairTicket.findUnique({
      where: { ticketCode },
      include: {
        user: true,
        assignees: { include: { user: true } },
        attachments: true,
        logs: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketCode} not found`);
    return ticket;
  }

  async update(id: number, dto: any, updatedById: number) {
    // Get original ticket to compare for notifications
    const originalTicket = await this.prisma.repairTicket.findUnique({
      where: { id },
      include: { assignees: { select: { userId: true } } },
    });

    // Validate status transition
    if (dto.status !== undefined && originalTicket && dto.status !== originalTicket.status) {
      if (!this.validateStatusTransition(originalTicket.status, dto.status)) {
        throw new BadRequestException(
          `ไม่สามารถเปลี่ยนสถานะจาก ${originalTicket.status} เป็น ${dto.status} ได้`
        );
      }
    }

    // Build update data with only valid fields
    const updateData: any = {};

    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.messageToReporter !== undefined) updateData.messageToReporter = dto.messageToReporter;
    // Dates need careful handling
    if (dto.scheduledAt) updateData.scheduledAt = new Date(dto.scheduledAt);
    if (dto.completedAt) updateData.completedAt = new Date(dto.completedAt);
    if (dto.estimatedCompletionDate) updateData.estimatedCompletionDate = new Date(dto.estimatedCompletionDate);
    
    if (dto.problemTitle !== undefined) updateData.problemTitle = dto.problemTitle;
    if (dto.problemDescription !== undefined) updateData.problemDescription = dto.problemDescription;
    if (dto.location !== undefined) updateData.location = dto.location;
    if (dto.urgency !== undefined) updateData.urgency = dto.urgency;

    try {
      // Track new assignees for notifications and history
      const previousAssigneeIds = originalTicket?.assignees.map(a => a.userId) || [];
      
      // Handle multi-assignee sync
      if (dto.assigneeIds !== undefined) {
        // Delete all existing assignees and recreate
        await this.prisma.repairTicketAssignee.deleteMany({
          where: { repairTicketId: id },
        });
        
        if (dto.assigneeIds.length > 0) {
          await this.prisma.repairTicketAssignee.createMany({
            data: dto.assigneeIds.map((userId: number) => ({
              repairTicketId: id,
              userId,
            })),
          });

          //LOG ASSIGNMENT HISTORY
          const addedIds = dto.assigneeIds.filter((id: number) => !previousAssigneeIds.includes(id));
          const removedIds = previousAssigneeIds.filter((id: number) => !dto.assigneeIds.includes(id));

          const historyData: any[] = [];
           // Log Assignments
          for (const uid of addedIds) {
              historyData.push({
                  repairTicketId: id,
                  action: 'ASSIGN',
                  assignerId: updatedById,
                  assigneeId: uid,
                  note: 'มอบหมายงาน'
              });
          }
          // Log Unassignments
          for (const uid of removedIds) {
               historyData.push({
                  repairTicketId: id,
                  action: 'UNASSIGN',
                  assignerId: updatedById,
                  assigneeId: uid,
                  note: 'ยกเลิกการมอบหมาย'
              });
          }
          if (historyData.length > 0) {
              await this.prisma.repairAssignmentHistory.createMany({ data: historyData });
          }
        }
      }

      // Log Status Changes (Accept/Reject)
      if (dto.status !== undefined && originalTicket && dto.status !== originalTicket.status) {
         let action = 'STATUS_CHANGE';
         
         const statusTh: Record<string, string> = {
           PENDING: 'รอรับงาน',
           ASSIGNED: 'มอบหมายแล้ว',
           IN_PROGRESS: 'กำลังดำเนินการ',
           WAITING_PARTS: 'รออะไหล่',
           COMPLETED: 'เสร็จสิ้น',
           CANCELLED: 'ยกเลิก'
         };

         const oldStatus = statusTh[originalTicket.status] || originalTicket.status;
         const newStatus = statusTh[dto.status] || dto.status;
         let note = `เปลี่ยนสถานะจาก ${oldStatus} เป็น ${newStatus}`;
         
         if (dto.status === 'IN_PROGRESS' && originalTicket.status === 'ASSIGNED') {
             action = 'ACCEPT';
             note = 'รับงาน';
         } else if (dto.status === 'PENDING' && originalTicket.status === 'ASSIGNED') {
             action = 'REJECT';
             note = 'ปฏิเสธงาน'; // Or get from dto.note if available?
         }

          await this.prisma.repairAssignmentHistory.create({
             data: {
                 repairTicketId: id,
                 action,
                 assignerId: updatedById,
                 assigneeId: updatedById, // Self-action
                 note
             }
          });
      }

      // Log Operational Notes and Messages
      if (dto.notes || dto.messageToReporter) {
          const logs: any[] = [];
          
          if (dto.notes) {
              logs.push({
                  repairTicketId: id,
                  action: 'NOTE',
                  assignerId: updatedById,
                  note: `หมายเหตุ: ${dto.notes}`
              });
          }
          
          if (dto.messageToReporter) {
              logs.push({
                  repairTicketId: id,
                  action: 'MESSAGE_TO_REPORTER',
                  assignerId: updatedById,
                  note: `แจ้งผู้ซ่อม: ${dto.messageToReporter}`
              });
          }
          
          if (logs.length > 0) {
              await this.prisma.repairAssignmentHistory.createMany({ data: logs });
          }
      }

      const ticket = await this.prisma.repairTicket.update({
        where: { id },
        data: updateData,
        include: {
          user: true,
          assignees: { include: { user: true } },
        },
      });

      // LINE Notifications
      try {
        // Notify new assignees
        if (dto.assigneeIds !== undefined) {
          const newAssigneeIds = dto.assigneeIds.filter((id: number) => !previousAssigneeIds.includes(id));
          
          for (const techId of newAssigneeIds) {
            await this.lineNotificationService.notifyTechnicianTaskAssignment(techId, {
              ticketCode: ticket.ticketCode,
              problemTitle: ticket.problemTitle,
              reporterName: ticket.reporterName,
              urgency: ticket.urgency as 'CRITICAL' | 'URGENT' | 'NORMAL',
              action: 'ASSIGNED',
            });
            this.logger.log(`Notified technician ${techId} for assignment: ${ticket.ticketCode}`);
          }
        }

        // Notify reporter on status change or assignment
        // Now include 'ASSIGNED' status or assignee changes to notify reporter
        if (dto.status !== undefined && originalTicket && (dto.status !== originalTicket.status || dto.assigneeIds !== undefined)) {
          const technicianNames = ticket.assignees.map(a => a.user.name);
          
          // Use messageToReporter if available, otherwise fall back to notes
          const remarkMessage = dto.messageToReporter || dto.notes;

          // Get ticket with attachments for image
          const ticketWithAttachments = await this.prisma.repairTicket.findUnique({
            where: { id: ticket.id },
            include: { attachments: { take: 1 } },
          });
          
          // Consolidated Notification Logic: Send only ONE notification to reporter
          if (ticketWithAttachments?.reporterLineUserId) {
            // Priority 1: Direct notification via reporterLineUserId (Special Flex template)
            const imageUrl = ticketWithAttachments.attachments?.[0]?.fileUrl;
            await this.lineNotificationService.notifyReporterDirectly(
              ticketWithAttachments.reporterLineUserId,
              {
                ticketCode: ticket.ticketCode,
                status: dto.status,
                urgency: ticket.urgency as 'CRITICAL' | 'URGENT' | 'NORMAL',
                problemTitle: ticket.problemTitle,
                description: ticket.problemDescription || ticket.problemTitle,
                imageUrl,
                createdAt: ticket.createdAt,
                remark: remarkMessage,
              }
            );
            this.logger.log(`Notified reporter directly for: ${ticket.ticketCode}`);
          } else {
            // Priority 2: Standard notification via user ID (Fallback if no direct ID)
            await this.lineNotificationService.notifyRepairTicketStatusUpdate(ticket.userId, {
              ticketCode: ticket.ticketCode,
              problemTitle: ticket.problemTitle,
              status: dto.status,
              remark: remarkMessage,
              technicianNames,
              updatedAt: new Date(),
            });
            this.logger.log(`Notified reporter via userId for: ${ticket.ticketCode}`);
          }
          
          this.logger.log(`Notified reporter for status change: ${ticket.ticketCode} -> ${dto.status}`);
        }
      } catch (notifError) {
        // Don't fail the update if notification fails
        this.logger.error('Failed to send LINE notification:', notifError);
      }

      return ticket;
    } catch (error: any) {
      // Handle "Record not found" error
      if (error.code === 'P2025') {
        throw new NotFoundException(`Repair ticket #${id} not found`);
      }
      // Handle "Foreign Key Constraint failed" (e.g. assignee user doesn't exist)
      if (error.code === 'P2003') {
        throw new BadRequestException(`ข้อมูลอ้างอิงไม่ถูกต้อง (เช่น ผู้รับผิดชอบไม่มีอยู่ในระบบ)`);
      }
      throw error;
    }
  }

  async remove(id: number) {
    // Get ticket data first to check existence
    const ticket = await this.prisma.repairTicket.findUnique({
      where: { id },
      include: {
        attachments: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Repair ticket #${id} not found`);
    }

    // Attempt to delete files from Cloudinary if publicId is stored
    // Note: If publicId isn't explicitly stored, we might need to extract it from URL
    // or rely on a manual cleanup if not critical. 
    // For now, focusing on database hard delete as requested.
    
    // Perform hard delete from database
    // Related records (attachments, logs, assignees, history) will be deleted via Cascade as defined in schema.prisma
    await this.prisma.repairTicket.delete({
      where: { id },
    });

    this.logger.log(`Hard deleted repair ticket: ${ticket.ticketCode}`);

    return { message: 'Deleted successfully', ticketCode: ticket.ticketCode };
  }

  async getStatistics() {
    const stats = await this.prisma.repairTicket.groupBy({
      by: ['status'],
      _count: {
        status: true,
      },
    });

    const total = stats.reduce((acc, curr) => acc + curr._count.status, 0);
    
    const getCount = (status: RepairTicketStatus) => 
      stats.find(s => s.status === status)?._count.status || 0;

    return {
      total,
      pending: getCount(RepairTicketStatus.PENDING),
      assigned: getCount(RepairTicketStatus.ASSIGNED),
      inProgress: getCount(RepairTicketStatus.IN_PROGRESS),
      waitingParts: getCount(RepairTicketStatus.WAITING_PARTS),
      completed: getCount(RepairTicketStatus.COMPLETED),
      cancelled: getCount(RepairTicketStatus.CANCELLED),
    };
  }

  async getDashboardStatistics(filter: 'day' | 'week' | 'month' = 'day', date?: Date) {
    const targetDate = date || new Date();
    
    // Calculate date range based on filter
    let startDate: Date;
    let endDate: Date;
    
    if (filter === 'day') {
      startDate = new Date(targetDate);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(targetDate);
      endDate.setHours(23, 59, 59, 999);
    } else if (filter === 'week') {
      const dayOfWeek = targetDate.getDay();
      startDate = new Date(targetDate);
      startDate.setDate(targetDate.getDate() - dayOfWeek);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else {
      startDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
      endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // Get all stats (no date filter) for main cards
    const allStats = await this.prisma.repairTicket.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    // Get filtered stats (with date filter) for "today" cards
    const filteredStats = await this.prisma.repairTicket.groupBy({
      by: ['status'],
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _count: { status: true },
    });

    const getCount = (stats: any[], status: RepairTicketStatus) =>
      stats.find(s => s.status === status)?._count.status || 0;

    const allTotal = allStats.reduce((acc, curr) => acc + curr._count.status, 0);
    const filteredTotal = filteredStats.reduce((acc, curr) => acc + curr._count.status, 0);

    // Get recent repairs for the table
    const recentRepairs = await this.prisma.repairTicket.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        ticketCode: true,
        createdAt: true,
        problemTitle: true,
        location: true,
        urgency: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      all: {
        total: allTotal,
        inProgress: getCount(allStats, RepairTicketStatus.IN_PROGRESS),
        completed: getCount(allStats, RepairTicketStatus.COMPLETED),
        cancelled: getCount(allStats, RepairTicketStatus.CANCELLED),
      },
      filtered: {
        total: filteredTotal,
        pending: getCount(filteredStats, RepairTicketStatus.PENDING),
        inProgress: getCount(filteredStats, RepairTicketStatus.IN_PROGRESS),
        completed: getCount(filteredStats, RepairTicketStatus.COMPLETED),
        cancelled: getCount(filteredStats, RepairTicketStatus.CANCELLED),
      },
      recentRepairs,
      dateRange: { startDate, endDate },
    };
  }

  async getDepartmentStatistics() {
    const departments = ['ไอที', 'ลูกหีบ', 'ฝ่ายอ้อย', 'กฏหมาย', 'บัญชี'];
    
    const stats = await Promise.all(
      departments.map(async (dept) => {
        const tickets = await this.prisma.repairTicket.findMany({
          where: { reporterDepartment: dept },
          select: { status: true },
        });

        const total = tickets.length;
        const pending = tickets.filter(t => t.status === RepairTicketStatus.PENDING).length;
        const inProgress = tickets.filter(t => t.status === RepairTicketStatus.IN_PROGRESS).length;
        const completed = tickets.filter(t => t.status === RepairTicketStatus.COMPLETED).length;
        const cancelled = tickets.filter(t => t.status === RepairTicketStatus.CANCELLED).length;

        return {
          department: dept,
          total,
          pending,
          inProgress,
          completed,
          cancelled,
        };
      })
    );

    return stats;
  }

  async getSchedule() {
    return this.prisma.repairTicket.findMany({
      select: {
        id: true,
        ticketCode: true,
        problemTitle: true,
        problemDescription: true,
        status: true,
        urgency: true,
        scheduledAt: true,
        createdAt: true,
        completedAt: true,
        location: true,
        reporterName: true,
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async findAll(params: {
    userId?: number;
    isAdmin?: boolean;
    status?: RepairTicketStatus;
    urgency?: UrgencyLevel;
    assignedTo?: number;
    limit?: number;
  }) {
    const {
      userId,
      isAdmin,
      status,
      urgency,
      assignedTo,
      limit,
    } = params;

    const where: any = {};

    // USER เห็นเฉพาะของตัวเอง
    if (!isAdmin && userId) {
      where.userId = userId;
    }

    if (status) where.status = status;
    if (urgency) where.urgency = urgency;
    if (assignedTo) where.assignedTo = assignedTo;

    return this.prisma.repairTicket.findMany({
      where,
      take: limit,
      include: {
        user: true,
        assignees: { include: { user: true } },
        // Optimized: Removed heavy relations (attachments, logs) for list view
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async findUserByLineId(lineUserId: string) {
    const link = await this.prisma.lineOALink.findFirst({
      where: { lineUserId },
      include: { user: true },
    });
    return link?.user;
  }

  async getUserTickets(userId: number) {
    return this.prisma.repairTicket.findMany({
      where: { userId },
      include: {
        user: true,
        assignees: { include: { user: true } },
        attachments: true,
        logs: {
          include: { user: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
