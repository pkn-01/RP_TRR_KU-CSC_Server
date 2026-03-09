// ===== จัดการสต็อกอุปกรณ์ | Stock Management Service =====
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface StockImportItem {
  code: string;
  name: string;
  category?: string;
  quantity: number;
}

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  // ดึงข้อมูลรายการสต็อกทั้งหมด | Get all stock items
  async findAll() {
    return this.prisma.stockItem.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { transactions: true } },
      },
    });
  }

  // ดึงข้อมูลสินค้าตาม ID พร้อมรายการธุรกรรมล่าสุด | Get stock item by ID with latest transactions
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
      throw new NotFoundException(`ไม่พบรหัส #${id}`);
    }
    return item;
  }

  // สร้างรายการสินค้าใหม่ | Create new stock item
  async create(data: Prisma.StockItemCreateInput) {
    return this.prisma.stockItem.create({ data });
  }

  // อัปเดตข้อมูลสินค้า | Update stock item info
  async update(id: number, data: Prisma.StockItemUpdateInput) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`ไม่พบรหัส #${id}`);
    }
    return this.prisma.stockItem.update({
      where: { id },
      data,
    });
  }

  // เบิกสินค้าออกจากคลัง | Withdraw items from stock
  async withdraw(id: number, quantity: number, reference?: string, note?: string, userId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id } });
      if (!item) {
        throw new NotFoundException(`ไม่พบรหัส #${id}`);
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

  // เพิ่มจำนวนสินค้าเข้าไปในคลัง | Add quantity to stock
  async addStock(id: number, quantity: number, reference?: string, note?: string, userId?: number) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({ where: { id } });
      if (!item) {
        throw new NotFoundException(`ไม่พบรหัส #${id}`);
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

  // ค้นหาประวัติธุรกรรมสต็อก | Find stock transactions
  async findTransactions(stockItemId?: number) {
    return this.prisma.stockTransaction.findMany({
      where: stockItemId ? { stockItemId } : {},
      orderBy: { createdAt: 'desc' },
      include: { stockItem: true },
    });
  }

  // ลบรายการสินค้าออกจากระบบ | Remove stock item
  async remove(id: number) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`ไม่พบรหัส #${id}`);
    }
    return this.prisma.stockItem.delete({
      where: { id },
    });
  }

  // ล้างค่าหมวดหมู่ของสินค้า | Clear category from stock items
  async deleteCategory(name: string) {
    return this.prisma.stockItem.updateMany({
      where: { category: name },
      data: { category: null },
    });
  }

  // นำเข้าข้อมูลสินค้าจำนวนมากจากไฟล์ | Bulk import stock items from file
  async bulkImport(items: StockImportItem[]) {
    let created = 0;
    let updated = 0;
    const errors: { code: string; name: string; error: string; category: string }[] = [];

    for (const item of items) {
      try {
        if (!item.code || !item.name || !item.category) {
          errors.push({ code: item.code || '(ว่าง)', name: item.name || '(ว่าง)', category: item.category || '(ว่าง)', error: 'ไม่มี code หรือ name หรือ category' });
          continue;
        }

        const existing = await this.prisma.stockItem.findUnique({
          where: {
            code_name_category: {
              code: item.code,
              name: item.name,
              category: item.category,
            },
          },
        });

        if (existing) {
          await this.prisma.stockItem.update({
            where: { id: existing.id },
            data: {
              quantity: item.quantity,
            },
          });
          updated++;
        } else {
          await this.prisma.stockItem.create({
            data: {
              code: item.code,
              name: item.name,
              category: item.category,
              quantity: item.quantity,
            },
          });
          created++;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`Error importing item ${item.code}:`, error);
        errors.push({ code: item.code || '(ว่าง)', name: item.name || '(ว่าง)', category: item.category || '(ว่าง)', error: errMsg });
      }
    }

    return { created, updated, total: items.length, errors };
  }
}
