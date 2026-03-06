import { Controller, Get, Post, Body, Res, UseGuards, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { DataManagementService, DataType } from './data-management.service';
import { ClearDataDto, ExportDataDto } from './dto/clear-data.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@Controller('api/data-management')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class DataManagementController {
  constructor(private readonly dataManagementService: DataManagementService) {}

  // ดึงรายการประเภทข้อมูลที่สามารถล้างหรือส่งออกได้ | Get list of manageable data types
  @Get('types')
  async getDataTypes() {
    return this.dataManagementService.getDataTypes();
  }

  // ส่งออกข้อมูลตามประเภทที่เลือกเป็นไฟล์ Excel | Export selected data types to Excel
  @Post('export')
  async exportData(@Body() dto: ExportDataDto, @Res() res: Response) {
    const result = await this.dataManagementService.exportToExcel(dto.types as DataType[]);
    
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', result.buffer.length);
    
    return res.status(HttpStatus.OK).send(result.buffer);
  }

  // ล้างข้อมูลออกจากระบบ (พร้อมตัวเลือกการสำรองข้อมูล) | Clear system data with optional backup
  @Post('clear')
  async clearData(@Body() dto: ClearDataDto, @Res() res: Response) {
    // If exportFirst is true, first export then clear
    if (dto.exportFirst) {
      const result = await this.dataManagementService.exportToExcel(dto.types as DataType[]);
      await this.dataManagementService.clearData(dto.types as DataType[]);
      
      // Prefix with backup- to indicate it's a backup before delete
      const filename = `backup-${result.fileName}`;
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', result.buffer.length);
      
      return res.status(HttpStatus.OK).send(result.buffer);
    }
    
    // Just clear without export
    const result = await this.dataManagementService.clearData(dto.types as DataType[]);
    return res.status(HttpStatus.OK).json(result);
  }
}
