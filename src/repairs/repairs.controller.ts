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
  @Post('liff/create')
  @UseInterceptors(FilesInterceptor('files', 3))
  async createFromLiff(
    @Req() req: any,
    @Body() body: Record<string, any>,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    try {
      const dto = new CreateRepairTicketDto();

      dto.reporterName = body.reporterName || 'ไม่ได้ระบุ';
      dto.reporterDepartment = body.reporterDepartment;
      dto.reporterPhone = body.reporterPhone;
      dto.location = body.location || 'ไม่ได้ระบุ';
      dto.problemTitle = body.problemTitle || 'ไม่มีหัวข้อ';

      dto.reporterLineId =
        body.reporterLineId && body.reporterLineId !== 'null'
          ? body.reporterLineId
          : 'Guest';

      dto.problemCategory = Object.values(ProblemCategory).includes(
        body.problemCategory,
      )
        ? body.problemCategory
        : ProblemCategory.OTHER;

      dto.urgency = Object.values(UrgencyLevel).includes(body.urgency)
        ? body.urgency
        : UrgencyLevel.NORMAL;

      dto.problemDescription = body.problemDescription || '';

      const user = await this.usersService.getOrCreateUserFromLine(
        dto.reporterLineId!,
        body.displayName,
        body.pictureUrl,
      );

      // Create ticket - notification is handled inside repairsService.create()
      return await this.repairsService.create(user.id, dto, files);
    } catch (error: any) {
      this.logger.error(error.message, error.stack);
      throw new HttpException(
        'สร้างรายการแจ้งซ่อมไม่สำเร็จ',
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
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRepairTicketDto,
    @Req() req: any,
  ) {
    try {
      // LINE notification is already handled in repairsService.update()
      // Do NOT send notification here to avoid duplicate notifications
      const updated = await this.repairsService.update(
        id,
        dto,
        req.user.id,
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
