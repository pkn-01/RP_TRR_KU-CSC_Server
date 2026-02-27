import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Request,
  UseInterceptors,
  UploadedFiles,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ForbiddenException,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('api/tickets')
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  @Post()
  @Public()
  @UseInterceptors(FilesInterceptor('files', 5))
  create(
    @Request() req: any,
    @Body() createTicketDto: CreateTicketDto,
    @UploadedFiles() files?: any[],
  ) {
    // Support both authenticated users and guests
    const userId = req.user?.id || null;
    return this.ticketsService.create(userId, createTicketDto, files);
  }

  @Get()
  findAll(@Request() req: any) {
    // Show all tickets for IT/ADMIN, only user's tickets for regular users
    const userRole = req.user?.role;
    const isAdmin = userRole === 'ADMIN' || userRole === 'IT';
    
    console.log(`GET /api/tickets - User: ${req.user?.id}, Role: ${userRole}, IsAdmin/IT: ${isAdmin}`);
    
    return this.ticketsService.findAll(isAdmin ? undefined : req.user.id);
  }

  // SECURITY: Removed @Public() — requires JWT authentication + ownership/role check
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    try {
      const ticket = await this.ticketsService.findOne(id);
      if (!ticket) {
        throw new NotFoundException(`Ticket with ID ${id} not found`);
      }
      // SECURITY: Only owner, assignee, or ADMIN/IT can view
      const isAdmin = ['ADMIN', 'IT'].includes(req.user?.role);
      const isOwner = ticket.userId === req.user?.id;
      const isAssignee = ticket.assignedTo === req.user?.id;
      if (!isAdmin && !isOwner && !isAssignee) {
        throw new ForbiddenException('Permission denied');
      }
      return ticket;
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to fetch ticket: ${error.message}`);
    }
  }

  // SECURITY: Removed @Public() — requires JWT authentication
  @Get('code/:code')
  @UseGuards(JwtAuthGuard)
  async findByCode(@Param('code') code: string, @Request() req: any) {
    try {
      const ticket = await this.ticketsService.findByCode(code);
      if (!ticket) {
        throw new NotFoundException(`Ticket with code ${code} not found`);
      }
      // SECURITY: Only owner, assignee, or ADMIN/IT can view
      const isAdmin = ['ADMIN', 'IT'].includes(req.user?.role);
      const isOwner = ticket.userId === req.user?.id;
      const isAssignee = ticket.assignedTo === req.user?.id;
      if (!isAdmin && !isOwner && !isAssignee) {
        throw new ForbiddenException('Permission denied');
      }
      return ticket;
    } catch (error: any) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to fetch ticket: ${error.message}`);
    }
  }

  // SECURITY: Removed @Public() — requires JWT + ADMIN/IT role to search by email
  @Get('search/by-email/:email')
  @UseGuards(JwtAuthGuard)
  async findByEmail(@Param('email') email: string, @Request() req: any) {
    // SECURITY: Only ADMIN/IT can search by email (PII protection)
    if (!['ADMIN', 'IT'].includes(req.user?.role)) {
      throw new ForbiddenException('Only ADMIN or IT can search by email');
    }
    try {
      const tickets = await this.ticketsService.findByEmail(email);
      return tickets;
    } catch (error: any) {
      throw new InternalServerErrorException(`Failed to search tickets: ${error.message}`);
    }
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTicketDto: UpdateTicketDto,
    @Request() req: any,
  ) {
    // SECURITY: Only owner, assignee, or ADMIN/IT can update
    const ticket = await this.ticketsService.findOne(id);
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    const isAdmin = ['ADMIN', 'IT'].includes(req.user?.role);
    const isOwner = ticket.userId === req.user?.id;
    const isAssignee = ticket.assignedTo === req.user?.id;
    if (!isAdmin && !isOwner && !isAssignee) {
      throw new ForbiddenException('Permission denied');
    }
    return this.ticketsService.update(id, updateTicketDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    // SECURITY: Only ADMIN or IT can delete tickets
    if (req.user?.role !== 'ADMIN' && req.user?.role !== 'IT') {
      throw new ForbiddenException('Only ADMIN or IT can delete tickets');
    }
    return this.ticketsService.remove(id);
  }
}
