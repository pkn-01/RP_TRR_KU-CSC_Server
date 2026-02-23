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

  /**
   * Generate repair ticket code in format: TRR-ddMMyyyyXXX
   * Example: TRR-10022569001
   */
  private async generateTicketCode(): Promise<string> {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear() + 543); // Convert to Buddhist Year
    
    // Prefix: TRR-10022569
    const prefix = `TRR-${day}${month}${year}`;
    
    // Find last ticket of the day with this prefix
    const lastTicket = await this.prisma.repairTicket.findFirst({
      where: {
        ticketCode: {
          startsWith: prefix,
        },
      },
      orderBy: {
        ticketCode: 'desc', // Get the latest one
      },
      select: {
        ticketCode: true,
      },
    });

    let sequence = 1;
    
    if (lastTicket && lastTicket.ticketCode) {
      // Extract the sequence part (last 3 digits)
      const lastSequenceStr = lastTicket.ticketCode.slice(-3);
      const lastSequence = parseInt(lastSequenceStr, 10);
      
      if (!isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }

    // Format sequence as 3 digits (e.g., 001, 002)
    const sequenceStr = String(sequence).padStart(3, '0');
    
    return `${prefix}${sequenceStr}`;
  }

  async create(userId: number, dto: any, files?: Express.Multer.File[], lineUserId?: string) {
    // Debug logging
    this.logger.log(`Creating ticket - lineUserId parameter: ${lineUserId || 'NOT PROVIDED'}`);
    this.logger.log(`Creating ticket - dto.reporterLineId: ${dto.reporterLineId || 'NOT PROVIDED'}`);
    
    // Generate custom ticket code: TRR-ddMMyyyyXXX
    const ticketCode = await this.generateTicketCode();
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

    // Note: IT team notification removed - IT staff will be notified only when admin assigns them to the ticket

    // 🔔 Notify REPORTER via LINE when new ticket is created
    try {
      const imageUrl = attachmentData.length > 0 ? attachmentData[0].fileUrl : undefined;

      // Logic for notification target:
      // 1. Use explicit lineUserId if provided (best case)
      // 2. Fallback to reporterLineId if it looks like a valid LINE User ID (starts with U)
      const targetLineUserId = lineUserId || (dto.reporterLineId && dto.reporterLineId.startsWith('U') ? dto.reporterLineId : undefined);

      if (targetLineUserId) {
        // Direct notification for guest users (LIFF)
        // ✅ MUST await on Vercel Serverless — fire-and-forget gets killed before completion
        await this.lineNotificationService.notifyReporterDirectly(targetLineUserId, {
          ticketCode: ticket.ticketCode,
          status: ticket.status,
          urgency: ticket.urgency as 'CRITICAL' | 'URGENT' | 'NORMAL',
          problemTitle: ticket.problemTitle,
          description: ticket.problemDescription || ticket.problemTitle,
          imageUrl,
          createdAt: ticket.createdAt,
        });
        
        this.logger.log(`LINE notification sent to reporter: ${targetLineUserId} (Source: ${lineUserId ? 'Direct' : 'Fallback'})`);
      } else if (userId) {
        // Notification for logged-in users
        // ✅ MUST await on Vercel Serverless
        await this.lineNotificationService.notifyRepairTicketStatusUpdate(userId, {
          ticketCode: ticket.ticketCode,
          problemTitle: ticket.problemTitle,
          status: ticket.status,
          technicianNames: [],
          updatedAt: ticket.createdAt,
        });

        this.logger.log(`LINE notification sent to user ${userId}`);
      }
    } catch (error) {
      // Don't fail the ticket creation if notification setup fails
      this.logger.error('Failed to initiate reporter LINE notification:', error);
    }

    return ticket;
  }

  // SECURITY: User select helper to never expose password hash
  private readonly safeUserSelect = {
    id: true, name: true, email: true, role: true,
    department: true, phoneNumber: true, lineId: true,
    profilePicture: true,
  } as const;

  async findOne(id: number) {
    const ticket = await this.prisma.repairTicket.findUnique({
      where: { id },
      include: {
        user: { select: this.safeUserSelect },
        assignees: { include: { user: { select: this.safeUserSelect } } },
        attachments: true,
        logs: { include: { user: { select: this.safeUserSelect } }, orderBy: { createdAt: 'desc' } },
        assignmentHistory: {
          include: { 
            assigner: { select: this.safeUserSelect },
            assignee: { select: this.safeUserSelect }
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
        user: { select: this.safeUserSelect },
        assignees: { include: { user: { select: this.safeUserSelect } } },
        attachments: true,
        logs: { include: { user: { select: this.safeUserSelect } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketCode} not found`);
    return ticket;
  }

  async update(id: number, dto: any, updatedById: number, files?: Express.Multer.File[]) {
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
    if (dto.completionReport !== undefined) updateData.notes = dto.completionReport; // Store completion report in notes
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
        // Ensure assigneeIds are numbers (fix for notification issue)
        dto.assigneeIds = Array.isArray(dto.assigneeIds) 
          ? dto.assigneeIds.map((id: any) => Number(id)) 
          : [];

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

      // Upload completion files FIRST (collect URLs for history)
      const uploadedImageUrls: string[] = [];
      if (files && files.length > 0) {
        for (const file of files) {
          try {
            if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
              this.logger.warn(`Rejected file with invalid MIME type: ${file.mimetype}`);
              continue;
            }
            if (file.size > MAX_FILE_SIZE) {
              this.logger.warn(`Rejected file exceeding size limit: ${file.size} bytes`);
              continue;
            }
            const sanitizedName = this.sanitizeFilename(file.originalname);
            const result = await this.cloudinaryService.uploadFile(
              file.buffer,
              sanitizedName,
              'repairs/completion',
            );
            await this.prisma.repairAttachment.create({
              data: {
                repairTicketId: id,
                filename: sanitizedName,
                fileUrl: result.url,
                fileSize: file.size,
                mimeType: file.mimetype,
              },
            });
            uploadedImageUrls.push(result.url);
          } catch (error) {
            this.logger.error(`Failed to upload completion file ${file.originalname}:`, error);
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
             note = 'ปฏิเสธงาน';
         }

         // Append completion report and images for COMPLETED status
         if (dto.status === 'COMPLETED') {
           if (dto.completionReport) {
             note += `\nรายงาน: ${dto.completionReport}`;
           }
           if (uploadedImageUrls.length > 0) {
             note += `\n[IMAGES:${uploadedImageUrls.join(',')}]`;
           }
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
            // Get first attachment image for the notification
            const ticketWithAttachments = await this.prisma.repairTicket.findUnique({
              where: { id: ticket.id },
              include: { attachments: { orderBy: { id: 'asc' }, take: 1 } },
            });
            const imageUrl = ticketWithAttachments?.attachments?.[0]?.fileUrl;

            await this.lineNotificationService.notifyTechnicianTaskAssignment(techId, {
              ticketCode: ticket.ticketCode,
              ticketId: ticket.id,
              problemTitle: ticket.problemTitle,
              problemDescription: ticket.problemDescription || undefined,
              adminNote: dto.notes || undefined,
              reporterName: ticket.reporterName,
              reporterPhone: ticket.reporterPhone || undefined,
              department: ticket.reporterDepartment || 'ไม่ระบุแผนก',
              location: ticket.location,
              urgency: ticket.urgency as 'CRITICAL' | 'URGENT' | 'NORMAL',
              action: 'ASSIGNED',
              imageUrl,
            });
            this.logger.log(`Notified technician ${techId} for assignment: ${ticket.ticketCode}`);
          }
        }

        // Notify technicians when job is COMPLETED
        if (dto.status === 'COMPLETED' && originalTicket && originalTicket.status !== 'COMPLETED') {
           const assignees = await this.prisma.repairTicketAssignee.findMany({
             where: { repairTicketId: id },
             include: { user: true }
           });

           // Get first attachment image for the completion notification
           const ticketForImage = await this.prisma.repairTicket.findUnique({
             where: { id },
             include: { attachments: { orderBy: { id: 'asc' }, take: 1 } },
           });
           const problemImageUrl = ticketForImage?.attachments?.[0]?.fileUrl;

           for (const assignee of assignees) {
              await this.lineNotificationService.notifyTechnicianJobCompletion(assignee.userId, {
                ticketCode: ticket.ticketCode,
                ticketId: ticket.id,
                problemTitle: ticket.problemTitle,
                reporterName: ticket.reporterName,
                department: ticket.reporterDepartment || undefined,
                location: ticket.location,
                completedAt: ticket.completedAt || new Date(),
                completionNote: dto.completionReport || dto.notes,
                problemImageUrl,
              });
              this.logger.log(`Notified technician ${assignee.userId} for completion: ${ticket.ticketCode}`);
           }
        }

        // Notify technicians when job is CANCELLED (if it had assignees)
        if (dto.status === 'CANCELLED' && originalTicket && originalTicket.status !== 'CANCELLED') {
           const assignees = await this.prisma.repairTicketAssignee.findMany({
             where: { repairTicketId: id },
             include: { user: true }
           });

           // Get first attachment image for the cancellation notification
           const ticketForCancelImage = await this.prisma.repairTicket.findUnique({
             where: { id },
             include: { attachments: { orderBy: { id: 'asc' }, take: 1 } },
           });
           const cancelProblemImageUrl = ticketForCancelImage?.attachments?.[0]?.fileUrl;

           for (const assignee of assignees) {
              await this.lineNotificationService.notifyTechnicianJobCancellation(assignee.userId, {
                ticketCode: ticket.ticketCode,
                ticketId: ticket.id,
                problemTitle: ticket.problemTitle,
                reporterName: ticket.reporterName,
                department: ticket.reporterDepartment || undefined,
                location: ticket.location,
                cancelledAt: new Date(),
                cancelNote: dto.notes,
                problemImageUrl: cancelProblemImageUrl,
              });
              this.logger.log(`Notified technician ${assignee.userId} for cancellation: ${ticket.ticketCode}`);
           }
        }

        // Notify reporter on status change (exclusively, ignore assignee changes)
        if (dto.status !== undefined && originalTicket && dto.status !== originalTicket.status) {
          const technicianNames = ticket.assignees.map(a => a.user.name);
          
          // Use messageToReporter if available, otherwise fall back to notes
          // SPECIAL CASE: If COMPLETED, use completionReport as the main remark
          let remarkMessage = dto.messageToReporter || dto.notes;
          
          if (dto.status === 'COMPLETED' && dto.completionReport) {
            remarkMessage = `รายงานการซ่อม: ${dto.completionReport}`;
          }

          // Get ticket with attachments for image
          const ticketWithAttachments = await this.prisma.repairTicket.findUnique({
            where: { id: ticket.id },
            include: { 
              attachments: { 
                orderBy: { id: 'asc' },
                take: 1 
              } 
            },
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

  async getDepartmentStatistics(filter?: 'day' | 'week' | 'month', date?: Date) {
    // Build date range filter when filter is provided
    let dateWhere: any = {};
    if (filter && date) {
      let startDate: Date;
      let endDate: Date;

      if (filter === 'day') {
        startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
      } else if (filter === 'week') {
        const dayOfWeek = date.getDay();
        startDate = new Date(date);
        startDate.setDate(date.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
      } else {
        startDate = new Date(date.getFullYear(), date.getMonth(), 1);
        endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
      }

      dateWhere = { createdAt: { gte: startDate, lte: endDate } };
    }

    // PERF: Single groupBy query replaces 5 separate N+1 queries
    const rawStats = await this.prisma.repairTicket.groupBy({
      by: ['reporterDepartment', 'status'],
      _count: { status: true },
      where: {
        reporterDepartment: { not: null },
        ...dateWhere,
      },
    });

    // Aggregate into department-level stats
    const deptMap = new Map<string, { total: number; pending: number; inProgress: number; completed: number; cancelled: number }>();

    for (const row of rawStats) {
      const dept = row.reporterDepartment || 'ไม่ระบุ';
      if (!deptMap.has(dept)) {
        deptMap.set(dept, { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 });
      }
      const stat = deptMap.get(dept)!;
      const count = row._count.status;
      stat.total += count;

      switch (row.status) {
        case RepairTicketStatus.PENDING:
          stat.pending += count;
          break;
        case RepairTicketStatus.IN_PROGRESS:
        case RepairTicketStatus.ASSIGNED:
        case RepairTicketStatus.WAITING_PARTS:
          stat.inProgress += count;
          break;
        case RepairTicketStatus.COMPLETED:
          stat.completed += count;
          break;
        case RepairTicketStatus.CANCELLED:
          stat.cancelled += count;
          break;
      }
    }

    return Array.from(deptMap.entries()).map(([department, stats]) => ({
      department,
      ...stats,
    }));
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
      take: limit || 100, // PERF: Default pagination to prevent unbounded queries
      include: {
        user: { select: this.safeUserSelect },
        assignees: { include: { user: { select: this.safeUserSelect } } },
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
        user: { select: this.safeUserSelect },
        assignees: { include: { user: { select: this.safeUserSelect } } },
        attachments: true,
        logs: {
          include: { user: { select: this.safeUserSelect } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
