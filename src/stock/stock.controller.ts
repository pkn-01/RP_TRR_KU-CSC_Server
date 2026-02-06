import { Controller, Get, Post, Body, Param, Delete, Put, ParseIntPipe } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockItem } from '@prisma/client';

@Controller('api/stock')
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
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.remove(id);
  }
}
