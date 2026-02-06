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
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { Public } from '../auth/public.decorator';

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

  @Get(':id')
  @Public()
  async findOne(@Param('id') id: string) {
    console.log(`[DEBUG] Fetching ticket with ID: ${id}`);
    try {
      const ticket = await this.ticketsService.findOne(+id);
      console.log(`[DEBUG] Ticket found:`, ticket ? 'Yes' : 'No');
      if (!ticket) {
        throw new NotFoundException(`Ticket with ID ${id} not found`);
      }
      console.log(`[DEBUG] Ticket ID:`, ticket.id, `Title:`, ticket.title);
      return ticket;
    } catch (error: any) {
      console.error(`[ERROR] Error fetching ticket ${id}:`, error.message);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to fetch ticket: ${error.message}`);
    }
  }

  @Get('code/:code')
  @Public()
  async findByCode(@Param('code') code: string) {
    console.log(`[DEBUG] Fetching ticket with code: ${code}`);
    try {
      const ticket = await this.ticketsService.findByCode(code);
      console.log(`[DEBUG] Ticket found:`, ticket ? 'Yes' : 'No');
      if (!ticket) {
        throw new NotFoundException(`Ticket with code ${code} not found`);
      }
      console.log(`[DEBUG] Ticket code:`, ticket.ticketCode, `Title:`, ticket.title);
      return ticket;
    } catch (error: any) {
      console.error(`[ERROR] Error fetching ticket with code ${code}:`, error.message);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(`Failed to fetch ticket: ${error.message}`);
    }
  }

  @Get('search/by-email/:email')
  @Public()
  async findByEmail(@Param('email') email: string) {
    console.log(`[DEBUG] Searching tickets with email: ${email}`);
    try {
      const tickets = await this.ticketsService.findByEmail(email);
      console.log(`[DEBUG] Tickets found:`, tickets.length);
      return tickets;
    } catch (error: any) {
      console.error(`[ERROR] Error searching tickets with email ${email}:`, error.message);
      throw new InternalServerErrorException(`Failed to search tickets: ${error.message}`);
    }
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateTicketDto: UpdateTicketDto,
  ) {
    return this.ticketsService.update(+id, updateTicketDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ticketsService.remove(+id);
  }
}
