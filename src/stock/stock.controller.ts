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

  @Delete(':id')
  @Roles(Role.ADMIN, Role.IT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.remove(id);
  }
}
