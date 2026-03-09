// ===== API แจ้งซ่อม | Repair Ticket Controller =====
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
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RepairsService } from './repairs.service';
import { CreateRepairTicketDto } from './dto/create-repair-ticket.dto';
import { UpdateRepairTicketDto } from './dto/update-repair-ticket.dto';
import {
  RepairTicketStatus,
  UrgencyLevel,
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
  // สร้างรายการแจ้งซ่อมผ่านหน้า LIFF (Public/Guest) | Create repair ticket via LIFF
  async createFromLiff(
    @Req() req: any,
    @Body() body: Record<string, any>,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    try {
      // กำจัดช่องโหว่ XSS 
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

      // ตรวจสอบ LINE Access Token เพื่อป้องกันการปลอมแปลง 
      const accessToken = body.accessToken;
      let validatedLineUserId: string | undefined;

      if (accessToken) {
        try {
          this.logger.log(`Verifying Access token for user profile...`);

          const response = await fetch('https://api.line.me/v2/profile', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` },
          });
          const lineProfile = await response.json();

          if (!response.ok || lineProfile.error) {
            this.logger.error(`LINE profile fetch failed: ${JSON.stringify(lineProfile)} (Status: ${response.status})`);
            throw new ForbiddenException(`Invalid LINE Access Token: ${lineProfile.message || 'Unknown error'}`);
          }
          validatedLineUserId = lineProfile.userId;
        } catch (error: any) {
          this.logger.error(`Token verification exception: ${error.message}`, error.stack);
          throw new ForbiddenException(`Failed to verify LINE Access Token: ${error.message}`);
        }
      }

      dto.reporterLineId = validatedLineUserId || 'Guest';

      // ตรวจสอบรูปแบบเบอร์โทรศัพท์ 
      const phoneRegex = /^0\d{9}$/;
      if (dto.reporterPhone && !phoneRegex.test(dto.reporterPhone)) {
        this.logger.warn(`Invalid phone format rejected: ${dto.reporterPhone}`);
        dto.reporterPhone = '';
      }

      dto.urgency = Object.values(UrgencyLevel).includes(body.urgency)
        ? body.urgency
        : UrgencyLevel.NORMAL;

      dto.problemDescription = rawDescription;

      const user = await this.usersService.getOrCreateUserFromLine(
        dto.reporterLineId!,
        body.displayName,
        body.pictureUrl,
      );

      // สร้างรายการแจ้งซ่อมพร้อม LINE notifications 
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
  // ดึงข้อมูลรายการแจ้งซ่อมสำหรับแสดงผลในหน้า LIFF 
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
  // ดึงรายการแจ้งซ่อมทั้งหมดของผู้ใช้รายนั้นๆ สำหรับ LIFF 
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
  // ดึงข้อมูลใบแจ้งซ่อมแบบสาธารณะ (ไม่ต้องใช้ Login) 
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

  // SECURITY: Removed public liff/ticket-by-id/:id endpoint
  // It exposed ticket data without authentication via sequential IDs (IDOR vulnerability)
  // Use liff/ticket-public/:code instead (requires ticket code, not guessable)

  /* =====================================================
      Protected APIs
  ===================================================== */

  @Get()
  @UseGuards(JwtAuthGuard)
  // ดึงข้อมูลรายการแจ้งซ่อมทั้งหมด (พร้อม Filter) 
  async findAll(
    @Req() req,
    @Query('status') status?: RepairTicketStatus,
    @Query('urgency') urgency?: UrgencyLevel,
    @Query('assignedTo') assignedTo?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const user = req.user;

    return this.repairsService.findAll({
      userId: user.id,
      isAdmin: user.role === Role.ADMIN || user.role === Role.IT,
      status,
      urgency,
      assignedTo: assignedTo ? Number(assignedTo) : undefined,
      limit: limit ? Number(limit) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('files', 3))
  // สร้างรายการแจ้งซ่อมใหม่ (Authenticated) 
  async create(
    @Req() req: any,
    @Body() dto: CreateRepairTicketDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.repairsService.create(req.user.id, dto, files);
  }

  @Get('schedule')
  @UseGuards(JwtAuthGuard)
  // ดึงข้อมูลตารางเวลาการซ่อม 
  async getSchedule() {
    return this.repairsService.getSchedule();
  }

  @Get('statistics/overview')
  @UseGuards(JwtAuthGuard)
  // ดึงข้อมูลสถิติภาพรวม 
  async getStatistics() {
    return this.repairsService.getStatistics();
  }

  @Get('statistics/dashboard')
  @UseGuards(JwtAuthGuard)
  // ดึงข้อมูลสถิติสำหรับหน้า Dashboard 
  async getDashboardStatistics(
    @Query('filter') filter: 'day' | 'week' | 'month' = 'day',
    @Query('date') dateStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const date = dateStr ? new Date(dateStr) : new Date();
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    return this.repairsService.getDashboardStatistics(filter, date, limit);
  }

  @Get('statistics/by-department')
  @UseGuards(JwtAuthGuard)
  // ดึงสถิติการแจ้งซ่อมแยกตามแผนก 
  async getDepartmentStatistics(
    @Query('filter') filter?: 'day' | 'week' | 'month',
    @Query('date') dateStr?: string,
  ) {
    const date = dateStr ? new Date(dateStr) : undefined;
    return this.repairsService.getDepartmentStatistics(filter, date);
  }

  @Get('user/my-tickets')
  @UseGuards(JwtAuthGuard)
  // ดึงรายการแจ้งซ่อมของผู้ใช้งานปัจจุบัน 
  async getUserTickets(@Req() req: any) {
    return this.repairsService.getUserTickets(req.user.id);
  }

  @Get('code/:code')
  @UseGuards(JwtAuthGuard)
  // ค้นหาใบแจ้งซ่อมด้วย Ticket Code 
  async findByCode(@Param('code') code: string) {
    return this.repairsService.findByCode(code);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  // ดึงข้อมูลใบแจ้งซ่อมตาม ID 
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.repairsService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('files', 5))
  // อัปเดตข้อมูลใบแจ้งซ่อม 
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
  // ลบใบแจ้งซ่อมออกจากระบบ (Hard Delete) 
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

  // ลบใบแจ้งซ่อมแบบกลุ่มตามช่วงเวลา (Bulk Delete)
  @Delete('bulk-delete/by-date')
  @UseGuards(JwtAuthGuard)
  @SetMetadata('roles', [Role.ADMIN])
  async bulkDeleteByDate(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Req() req: any,
  ) {
    if (!startDate || !endDate) {
      throw new BadRequestException('Both startDate and endDate are required for bulk deletion');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    return this.repairsService.removeByDateRange(start, end);
  }

  // ลบใบแจ้งซ่อมแบบกลุ่มตามรายการ ID (Bulk Delete by IDs)
  @Delete('bulk-delete/by-ids')
  @UseGuards(JwtAuthGuard)
  async bulkDeleteByIDs(
    @Body('ids') ids: number[],
    @Req() req: any,
  ) {
    // SECURITY: Only ADMIN and IT can bulk delete tickets
    if (req.user.role !== Role.ADMIN && req.user.role !== Role.IT) {
      throw new ForbiddenException('Permission denied: Only ADMIN or IT can delete repair tickets');
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('An array of IDs is required for bulk deletion');
    }

    return this.repairsService.removeMany(ids.map(id => Number(id)));
  }
}
