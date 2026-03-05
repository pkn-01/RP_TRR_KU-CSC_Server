import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.stockItem.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { transactions: true } },
      },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.stockItem.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!item) {
      throw new NotFoundException(`ไม่พบสินค้ารหัส #${id}`);
    }
    return item;
  }

  async create(data: Prisma.StockItemCreateInput) {
    return this.prisma.stockItem.create({ data });
  }

  async update(id: number, data: Prisma.StockItemUpdateInput) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`ไม่พบสินค้ารหัส #${id}`);
    }
    return this.prisma.stockItem.update({
      where: { id },
      data,
    });
  }

  async withdraw(id: number, quantity: number, reference?: string, note?: string, userId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id } });
      if (!item) {
        throw new NotFoundException(`ไม่พบสินค้ารหัส #${id}`);
      }
      if (item.quantity < quantity) {
        throw new BadRequestException(
          `สต๊อกไม่เพียงพอ (คงเหลือ ${item.quantity}, ต้องการเบิก ${quantity})`,
        );
      }

      const newQty = item.quantity - quantity;

      await tx.stockItem.update({
        where: { id },
        data: { quantity: newQty },
      });

      return tx.stockTransaction.create({
        data: {
          stockItemId: id,
          type: 'OUT',
          quantity,
          previousQty: item.quantity,
          newQty,
          reference,
          note,
          userId,
        },
      });
    });
  }

  async addStock(id: number, quantity: number, reference?: string, note?: string, userId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id } });
      if (!item) {
        throw new NotFoundException(`ไม่พบสินค้ารหัส #${id}`);
      }

      const newQty = item.quantity + quantity;

      await tx.stockItem.update({
        where: { id },
        data: { quantity: newQty },
      });

      return tx.stockTransaction.create({
        data: {
          stockItemId: id,
          type: 'IN',
          quantity,
          previousQty: item.quantity,
          newQty,
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
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`ไม่พบสินค้ารหัส #${id}`);
    }
    return this.prisma.stockItem.delete({
      where: { id },
    });
  }

  async deleteCategory(name: string) {
    return this.prisma.stockItem.updateMany({
      where: { category: name },
      data: { category: null },
    });
  }

  async bulkImport(items: Prisma.StockItemCreateInput[]) {
    return this.prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;

      for (const item of items) {
        const existing = await tx.stockItem.findUnique({
          where: { code: item.code },
        });

        if (existing) {
          await tx.stockItem.update({
            where: { code: item.code },
            data: {
              name: item.name,
              category: item.category,
              quantity: item.quantity,
            },
          });
          updated++;
        } else {
          await tx.stockItem.create({ data: item });
          created++;
        }
      }

      return { created, updated, total: items.length };
    });
  }
}
