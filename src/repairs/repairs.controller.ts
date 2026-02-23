import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Req,
  UseInterceptors,
  UploadedFiles,
  Query,
  SetMetadata,
  HttpException,
  HttpStatus,
  Logger,
  ParseIntPipe,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RepairsService } from './repairs.service';
import { CreateRepairTicketDto } from './dto/create-repair-ticket.dto';
import { UpdateRepairTicketDto } from './dto/update-repair-ticket.dto';
import {
  RepairTicketStatus,
  UrgencyLevel,
  ProblemCategory,
  Role
} from '@prisma/client';
import { LineOANotificationService } from '../line-oa/line-oa-notification.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('api/repairs')
export class RepairsController {
  private readonly logger = new Logger(RepairsController.name);

  constructor(
    private readonly repairsService: RepairsService,
    private readonly lineNotificationService: LineOANotificationService,
    private readonly usersService: UsersService,
  ) {}

  /* =====================================================
      LIFF : Create Ticket (Public)
  ===================================================== */

  @SetMetadata('isPublic', true)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // Stricter: 5 requests per minute for public form
  @Post('liff/create')
  @UseInterceptors(FilesInterceptor('files', 3))
  async createFromLiff(
    @Req() req: any,
    @Body() body: Record<string, any>,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    try {
      // Sanitize all string inputs to prevent XSS
      const sanitize = (str: string | undefined): string =>
        str ? str.replace(/<[^>]*>/g, '').trim() : '';

      const dto = new CreateRepairTicketDto();

      dto.reporterName = sanitize(body.reporterName) || 'ไม่ได้ระบุ';
      dto.reporterDepartment = sanitize(body.reporterDepartment);
      dto.reporterPhone = sanitize(body.reporterPhone);
      dto.location = sanitize(body.location) || 'ไม่ได้ระบุ';

      
      const rawTitle = sanitize(body.problemTitle) || sanitize(body.problemDescription) || 'ไม่มีหัวข้อ';
      const rawDescription = sanitize(body.problemDescription) || sanitize(body.problemTitle) || '';

      if (rawTitle === rawDescription && rawTitle.length > 100) {
        dto.problemTitle = rawTitle.substring(0, 100) + '...';
      } else {
        dto.problemTitle = rawTitle;
      }

      // SECURITY: Validate lineUserId format (LINE User IDs = U + 32 hex chars)
      const lineUserIdRegex = /^U[0-9a-f]{32}$/;
      const rawLineUserId = body.reporterLineId || body.lineUserId;
      const validatedLineUserId = (rawLineUserId && lineUserIdRegex.test(rawLineUserId))
        ? rawLineUserId
        : undefined;

      if (rawLineUserId && !validatedLineUserId) {
        this.logger.warn(`SECURITY: Invalid lineUserId format rejected: ${rawLineUserId}`);
      }

      dto.reporterLineId = validatedLineUserId || 'Guest';

      // SECURITY: Validate phone format (10 digits starting with 0)
      const phoneRegex = /^0\d{9}$/;
      if (dto.reporterPhone && !phoneRegex.test(dto.reporterPhone)) {
        this.logger.warn(`Invalid phone format rejected: ${dto.reporterPhone}`);
        dto.reporterPhone = '';
      }

      dto.problemCategory = Object.values(ProblemCategory).includes(
        body.problemCategory,
      )
        ? body.problemCategory
        : ProblemCategory.OTHER;

      dto.urgency = Object.values(UrgencyLevel).includes(body.urgency)
        ? body.urgency
        : UrgencyLevel.NORMAL;

      dto.problemDescription = rawDescription;

      const user = await this.usersService.getOrCreateUserFromLine(
        dto.reporterLineId!,
        body.displayName,
        body.pictureUrl,
      );

      // Create ticket with validated lineUserId for direct LINE notifications
      return await this.repairsService.create(user.id, dto, files, validatedLineUserId);
    } catch (error: any) {
      this.logger.error(`LIFF Create Error: ${error.message}`, error.stack);
      
      const msg = error.response?.message || error.message || 'สร้างรายการแจ้งซ่อมไม่สำเร็จ';
      
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: msg,
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* =====================================================
      LIFF : Read
  ===================================================== */

  @SetMetadata('isPublic', true)
  @Get('liff/ticket/:code')
  async getTicketForLiff(
    @Param('code') code: string,
    @Query('lineUserId') lineUserId: string,
  ) {
    if (!lineUserId) {
      throw new HttpException(
        'LINE User ID is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.repairsService.findUserByLineId(lineUserId);
    if (!user) {
      throw new HttpException(
        'User not linked to LINE',
        HttpStatus.FORBIDDEN,
      );
    }

    const ticket = await this.repairsService.findByCode(code);

    const isOwner = ticket.userId === user.id;
    const isAdmin = ['ADMIN', 'IT'].includes(user.role);

    if (!isOwner && !isAdmin) {
      throw new HttpException(
        'Permission denied',
        HttpStatus.FORBIDDEN,
      );
    }

    return ticket;
  }

  @SetMetadata('isPublic', true)
  @Get('liff/my-tickets')
  async getLiffUserTickets(@Query('lineUserId') lineUserId: string) {
    if (!lineUserId) {
      throw new HttpException(
        'LINE User ID is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.repairsService.findUserByLineId(lineUserId);
    if (!user) return [];

    return this.repairsService.getUserTickets(user.id);
  }

  /* =====================================================
      LIFF : Public Ticket Tracking (No Login Required)
  ===================================================== */

  @SetMetadata('isPublic', true)
  @Get('liff/ticket-public/:code')
  async getTicketPublic(@Param('code') code: string) {
    try {
      const ticket = await this.repairsService.findByCode(code);
      return ticket;
    } catch (error) {
      throw new HttpException(
        'Ticket not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /* =====================================================
      Protected APIs
  ===================================================== */

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req,
    @Query('status') status?: RepairTicketStatus,
    @Query('urgency') urgency?: UrgencyLevel,
    @Query('assignedTo') assignedTo?: string,
    @Query('limit') limit?: string,
  ) {
    const user = req.user;

    return this.repairsService.findAll({
      userId: user.id,
      isAdmin: user.role === Role.ADMIN || user.role === Role.IT,
      status,
      urgency,
      assignedTo: assignedTo ? Number(assignedTo) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('files', 3))
  async create(
    @Req() req: any,
    @Body() dto: CreateRepairTicketDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.repairsService.create(req.user.id, dto, files);
  }

  @Get('schedule')
  @UseGuards(JwtAuthGuard)
  async getSchedule() {
    return this.repairsService.getSchedule();
  }

  @Get('statistics/overview')
  @UseGuards(JwtAuthGuard)
  async getStatistics() {
    return this.repairsService.getStatistics();
  }

  @Get('statistics/dashboard')
  @UseGuards(JwtAuthGuard)
  async getDashboardStatistics(
    @Query('filter') filter: 'day' | 'week' | 'month' = 'day',
    @Query('date') dateStr?: string,
  ) {
    const date = dateStr ? new Date(dateStr) : new Date();
    return this.repairsService.getDashboardStatistics(filter, date);
  }

  @Get('statistics/by-department')
  @UseGuards(JwtAuthGuard)
  async getDepartmentStatistics(
    @Query('filter') filter?: 'day' | 'week' | 'month',
    @Query('date') dateStr?: string,
  ) {
    const date = dateStr ? new Date(dateStr) : undefined;
    return this.repairsService.getDepartmentStatistics(filter, date);
  }

  @Get('user/my-tickets')
  @UseGuards(JwtAuthGuard)
  async getUserTickets(@Req() req: any) {
    return this.repairsService.getUserTickets(req.user.id);
  }

  @Get('code/:code')
  @UseGuards(JwtAuthGuard)
  async findByCode(@Param('code') code: string) {
    return this.repairsService.findByCode(code);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.repairsService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('files', 5))
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRepairTicketDto,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    try {
      const updated = await this.repairsService.update(
        id,
        dto,
        req.user.id,
        files,
      );

      return updated;
    } catch (error: any) {
      this.logger.error(`Update repair #${id} failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    // SECURITY: Only ADMIN and IT can delete tickets
    if (req.user.role !== Role.ADMIN && req.user.role !== Role.IT) {
      throw new ForbiddenException('Permission denied: Only ADMIN or IT can delete repair tickets');
    }
    return this.repairsService.remove(id);
  }
}
