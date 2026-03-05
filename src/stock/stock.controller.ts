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

  @Get()
  async findAll() {
    return this.stockService.findAll();
  }

  // ต้องอยู่ก่อน :id เพื่อไม่ให้ NestJS จับ "transactions" เป็น id
  @Get('transactions')
  async getTransactions(@Query('stockItemId') stockItemId?: string) {
    const parsedId = stockItemId ? parseInt(stockItemId, 10) : undefined;
    return this.stockService.findTransactions(parsedId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.findOne(id);
  }

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

  @Delete(':id')
  @Roles(Role.ADMIN, Role.IT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.remove(id);
  }

  @Delete('categories/:name')
  @Roles(Role.ADMIN, Role.IT)
  async deleteCategory(@Param('name') name: string) {
    return this.stockService.deleteCategory(name);
  }

  @Post('bulk-import')
  @Roles(Role.ADMIN, Role.IT)
  async bulkImport(@Body() bulkImportDto: BulkImportStockDto) {
    return this.stockService.bulkImport(bulkImportDto.items);
  }
}
