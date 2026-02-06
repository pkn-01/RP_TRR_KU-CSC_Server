import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.stockItem.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: number) {
    return this.prisma.stockItem.findUnique({
      where: { id },
    });
  }

  async create(data: Prisma.StockItemCreateInput) {
    return this.prisma.stockItem.create({
      data,
    });
  }

  async remove(id: number) {
    return this.prisma.stockItem.delete({
      where: { id },
    });
  }
}
