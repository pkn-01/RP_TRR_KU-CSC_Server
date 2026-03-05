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

  async update(id: number, data: Prisma.StockItemUpdateInput) {
    return this.prisma.stockItem.update({
      where: { id },
      data,
    });
  }

  async withdraw(id: number, quantity: number, reference?: string, note?: string, userId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id } });
      if (!item) throw new Error('Item not found');
      if (item.quantity < quantity) throw new Error('Insufficient stock');

      const newQty = item.quantity - quantity;
      
      // Update Stock Item
      await tx.stockItem.update({
        where: { id },
        data: { quantity: newQty },
      });

      // Create Transaction Record
      return tx.stockTransaction.create({
        data: {
          stockItemId: id,
          type: 'OUT',
          quantity: quantity,
          previousQty: item.quantity,
          newQty: newQty,
          reference,
          note,
          userId,
        },
      });
    });
  }

  async findTransactions(stockItemId?: number) {
    return this.prisma.stockTransaction.findMany({
      where: stockItemId ? { stockItemId } : {},
      orderBy: { createdAt: 'desc' },
      include: { stockItem: true },
    });
  }

  async remove(id: number) {
    return this.prisma.stockItem.delete({
      where: { id },
    });
  }
}
