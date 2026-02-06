import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Priority } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
  ) {}

  private generateTicketCode(): string {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `TKT-${new Date().getFullYear()}-${timestamp}${random}`;
  }

  async create(
    userId: number | null,
    createTicketDto: CreateTicketDto,
    files?: any[],
  ) {
    const ticketCode = this.generateTicketCode();

    // Build data object with only provided fields
    const data: any = {
      ticketCode,
      title: createTicketDto.title,
      description: createTicketDto.description,
      equipmentName: createTicketDto.equipmentName,
      priority: (createTicketDto.priority as Priority) || Priority.MEDIUM,
      userId,
      // Provide defaults for required fields
      location: createTicketDto.location || 'N/A',
      category: createTicketDto.category || 'OTHER',
      problemCategory: createTicketDto.problemCategory || 'HARDWARE',
      problemSubcategory: createTicketDto.problemSubcategory || 'OTHER',
    };

    // Add guest information if provided
    if (createTicketDto.guestName) data.guestName = createTicketDto.guestName;
    if (createTicketDto.guestEmail) data.guestEmail = createTicketDto.guestEmail;
    if (createTicketDto.guestPhone) data.guestPhone = createTicketDto.guestPhone;
    if (createTicketDto.guestDepartment) data.guestDepartment = createTicketDto.guestDepartment;

    // Add optional repair ticket fields if provided
    if (createTicketDto.equipmentId !== undefined) data.equipmentId = createTicketDto.equipmentId;
    if (createTicketDto.notes !== undefined) data.notes = createTicketDto.notes;
    if (createTicketDto.requiredDate !== undefined) data.requiredDate = createTicketDto.requiredDate;

    // Handle assignee if provided
    if (createTicketDto.assignee?.id) {
      data.assignedTo = parseInt(createTicketDto.assignee.id);
    }

    const ticket = await this.prisma.ticket.create({
      data,
      include: {
        attachments: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Handle file uploads to Cloudinary
    if (files && files.length > 0) {
      const attachments: any[] = [];
      for (const file of files) {
        try {
          const result = await this.cloudinaryService.uploadFile(
            file.buffer,
            file.originalname,
            'tickets', // Cloudinary folder
          );

          attachments.push({
            ticketId: ticket.id,
            filename: file.originalname,
            fileUrl: result.url,
            fileSize: file.size,
            mimeType: file.mimetype,
          });
        } catch (error) {
          console.error(`Failed to upload file ${file.originalname}:`, error);
          // Continue with other files even if one fails
        }
      }

      if (attachments.length > 0) {
        await this.prisma.attachment.createMany({
          data: attachments,
        });
      }
    }

    return ticket;
  }

  async findAll(userId?: number) {
    return this.prisma.ticket.findMany({
      where: userId ? { userId } : undefined,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        attachments: true,
        logs: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    return this.prisma.ticket.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  async findByCode(code: string) {
    return this.prisma.ticket.findUnique({
      where: { ticketCode: code },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        attachments: true,
        logs: true,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.ticket.findMany({
      where: {
        OR: [
          { user: { email } },
          { guestEmail: email },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        attachments: true,
        logs: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async update(id: number, updateTicketDto: UpdateTicketDto) {
    // Filter out undefined values and handle assignee specially
    const updateData: any = {};
    
    // Handle regular fields
    if (updateTicketDto.title !== undefined) updateData.title = updateTicketDto.title;
    if (updateTicketDto.description !== undefined) updateData.description = updateTicketDto.description;
    if (updateTicketDto.equipmentName !== undefined) updateData.equipmentName = updateTicketDto.equipmentName;
    if (updateTicketDto.equipmentId !== undefined) updateData.equipmentId = updateTicketDto.equipmentId;
    if (updateTicketDto.notes !== undefined) updateData.notes = updateTicketDto.notes;
    if (updateTicketDto.requiredDate !== undefined) updateData.requiredDate = updateTicketDto.requiredDate;
    if (updateTicketDto.priority !== undefined) updateData.priority = updateTicketDto.priority;
    if (updateTicketDto.status !== undefined) updateData.status = updateTicketDto.status;
    
    // Handle assignee - convert to assignedTo field
    if (updateTicketDto.assignee !== undefined) {
      if (updateTicketDto.assignee && updateTicketDto.assignee.id) {
        updateData.assignedTo = parseInt(updateTicketDto.assignee.id);
      } else {
        updateData.assignedTo = null;
      }
    }

    return this.prisma.ticket.update({
      where: { id },
      data: updateData,
      include: {
        attachments: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async remove(id: number) {
    return this.prisma.ticket.delete({
      where: { id },
    });
  }
}
