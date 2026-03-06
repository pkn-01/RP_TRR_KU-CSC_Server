import { Controller, Get, Post, Body, Param, Delete, Put, ParseIntPipe, UseGuards, Query } from '@nestjs/common';
import { StockService } from './stock.service';
import { Role } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateStockDto } from './dto/create-stock.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { WithdrawStockDto } from './dto/withdraw-stock.dto';
import { AddStockDto } from './dto/add-stock.dto';
import { BulkImportStockDto } from './dto/bulk-import-stock.dto';

@Controller('api/stock')
@UseGuards(RolesGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  // ดึงข้อมูลรายการสินค้าทั้งหมดในสต็อก | Get all stock items
  @Get()
  async findAll() {
    return this.stockService.findAll();
  }

  // ต้องอยู่ก่อน :id เพื่อไม่ให้ NestJS จับ "transactions" เป็น id
  // ดึงประวัติการเคลื่อนไหวสต็อก (In/Out) | Get stock transaction history
  @Get('transactions')
  async getTransactions(@Query('stockItemId') stockItemId?: string) {
    const parsedId = stockItemId ? parseInt(stockItemId, 10) : undefined;
    return this.stockService.findTransactions(parsedId);
  }

  // ดึงข้อมูลสินค้าตาม ID | Get stock item by ID
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.findOne(id);
  }

  // เพิ่มรายการสินค้าใหม่เข้าสู่ระบบ | Create new stock item
  @Post()
  @Roles(Role.ADMIN, Role.IT)
  async create(@Body() createStockDto: CreateStockDto) {
    return this.stockService.create({
      code: createStockDto.code,
      name: createStockDto.name,
      quantity: createStockDto.quantity,
      category: createStockDto.category,
    });
  }

  // อัปเดตข้อมูลรายละเอียดสินค้า | Update stock item info
  @Put(':id')
  @Roles(Role.ADMIN, Role.IT)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateStockDto: UpdateStockDto,
  ) {
    return this.stockService.update(id, {
      code: updateStockDto.code,
      name: updateStockDto.name,
      quantity: updateStockDto.quantity !== undefined ? updateStockDto.quantity : undefined,
      category: updateStockDto.category,
    });
  }

  // บันทึกการเบิกสินค้าออกจากสต็อก | Record stock withdrawal
  @Post(':id/withdraw')
  @Roles(Role.ADMIN, Role.IT)
  async withdraw(
    @Param('id', ParseIntPipe) id: number,
    @Body() withdrawDto: WithdrawStockDto,
  ) {
    return this.stockService.withdraw(
      id,
      withdrawDto.quantity,
      withdrawDto.reference,
      withdrawDto.note,
      withdrawDto.userId,
    );
  }

  // บันทึกการเพิ่มจำนวนสินค้าเข้าสต็อก | Record stock addition
  @Post(':id/add-stock')
  @Roles(Role.ADMIN, Role.IT)
  async addStock(
    @Param('id', ParseIntPipe) id: number,
    @Body() addStockDto: AddStockDto,
  ) {
    return this.stockService.addStock(
      id,
      addStockDto.quantity,
      addStockDto.reference,
      addStockDto.note,
      addStockDto.userId,
    );
  }

  // ลบรายการสินค้าออกจากระบบ | Remove stock item from system
  @Delete(':id')
  @Roles(Role.ADMIN, Role.IT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.remove(id);
  }

  // ล้างค่าหมวดหมู่สินค้า | Clear product category
  @Delete('categories/:name')
  @Roles(Role.ADMIN, Role.IT)
  async deleteCategory(@Param('name') name: string) {
    return this.stockService.deleteCategory(name);
  }

  // นำเข้าข้อมูลสินค้าจำนวนมาก | Bulk import stock items
  @Post('bulk-import')
  @Roles(Role.ADMIN, Role.IT)
  async bulkImport(@Body() bulkImportDto: BulkImportStockDto) {
    return this.stockService.bulkImport(bulkImportDto.items);
  }
}
