import { Controller, Get, Post, Body, Param, Delete, Put, ParseIntPipe, UseGuards } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockItem, Role } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('api/stock')
@UseGuards(RolesGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  async findAll() {
    return this.stockService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.IT)
  async create(@Body() data: any) {
    // Basic validation could be improved with DTOs
    return this.stockService.create({
      code: data.code,
      name: data.name,
      quantity: Number(data.quantity),
      category: data.category,
      location: data.location,
    });
  }

  @Put(':id')
  @Roles(Role.ADMIN, Role.IT)
  async update(@Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.stockService.update(id, {
      code: data.code,
      name: data.name,
      quantity: data.quantity !== undefined ? Number(data.quantity) : undefined,
      category: data.category,
      location: data.location,
    });
  }

  @Post(':id/withdraw')
  @Roles(Role.ADMIN, Role.IT)
  async withdraw(@Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.stockService.withdraw(
      id,
      Number(data.quantity),
      data.reference,
      data.note,
      data.userId, // This could be extracted from JWT if available
    );
  }

  @Get('transactions')
  async getTransactions(@Param('stockItemId') stockItemId?: number) {
    return this.stockService.findTransactions(stockItemId);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.IT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.remove(id);
  }
}
