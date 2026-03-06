import { Controller, Get, Post, Body, Param, Put, Delete, Request, BadRequestException, Logger } from '@nestjs/common';
import { LoansService } from './loans.service';

@Controller('api/loans')
export class LoansController {
  private readonly logger = new Logger(LoansController.name);
  constructor(private loansService: LoansService) {}

  // สร้างรายการยืมอุปกรณ์ใหม่ 
  @Post()
  async create(@Body() body: any, @Request() req: any) {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId) {
        throw new BadRequestException('User ID not found');
      }

      return await this.loansService.create({
        itemName: body.itemName,
        description: body.description,
        quantity: body.quantity,
        expectedReturnDate: body.expectedReturnDate,
        userId,
        borrowerName: body.borrowerName,
        borrowerDepartment: body.borrowerDepartment,
        borrowerPhone: body.borrowerPhone,
        borrowerLineId: body.borrowerLineId,
      });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  // ดึงข้อมูลรายการยืมทั้งหมดสำหรับ Admin 
  @Get('admin/all')
  async findAllForAdmin(@Request() req: any) {
    try {
      const userId = req.user?.sub || req.user?.id;
      const userRole = req.user?.role;
      
      if (!userId) {
        throw new BadRequestException('User ID not found');
      }
      
      if (userRole !== 'ADMIN' && userRole !== 'IT') {
        throw new BadRequestException('Only admins can view all loans');
      }
      
      return await this.loansService.findAll(null);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  // ตรวจสอบและอัพเดตสถานะการยืมที่เกินกำหนด 
  @Get('check/overdue')
  async checkOverdue() {
    try {
      return await this.loansService.checkOverdue();
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  // ดึงข้อมูลรายการยืม (แสดงผลตามสิทธิ์ของผู้ใช้) 
  @Get()
  async findAll(@Request() req: any) {
    try {
      this.logger.debug(`GET /api/loans - userId: ${req.user?.sub || req.user?.id}`);
      
      const userId = req.user?.sub || req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        throw new BadRequestException('User ID not found');
      }

     
      const isStaff = userRole === 'ADMIN' || userRole === 'IT';
      const searchId = isStaff ? null : userId;
      
      this.logger.debug(`GET /api/loans - Role: ${userRole}, Fetching for: ${isStaff ? 'ALL' : userId}`);
      
      return await this.loansService.findAll(searchId);
    } catch (error: any) {
      this.logger.error(`GET /api/loans failed: ${error.message}`, error.stack);
      throw new BadRequestException(error.message);
    }
  }

  // ดึงข้อมูลการยืมรายบุคคลตาม ID 
  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      return await this.loansService.findOne(parseInt(id));
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  // อัปเดตข้อมูลการยืมหรือสถานะการคืน 
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    try {
      this.logger.debug(`PUT /api/loans/${id} - status: ${body.status}`);
      
      const result = await this.loansService.update(parseInt(id), {
        status: body.status,
        returnDate: body.returnDate,
        itemName: body.itemName,
        description: body.description,
        quantity: body.quantity,
        expectedReturnDate: body.expectedReturnDate,
        borrowerName: body.borrowerName,
        borrowerDepartment: body.borrowerDepartment,
        borrowerPhone: body.borrowerPhone,
        borrowerLineId: body.borrowerLineId,
      });
      
      this.logger.debug(`PUT /api/loans/${id} - Update successful`);
      return result;
    } catch (error: any) {
      this.logger.error(`PUT /api/loans/${id} failed: ${error.message}`, error.stack);
      throw new BadRequestException(error.message);
    }
  }

  // ลบข้อมูลการยืมออกจากระบบ 
  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      return await this.loansService.delete(parseInt(id));
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }
}
