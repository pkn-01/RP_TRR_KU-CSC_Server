// ===== ระบบยืม-คืนอุปกรณ์ | Loan Management Service =====
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, LoanStatus } from '@prisma/client';

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);
  constructor(private prisma: PrismaService) {}

  // สร้างรายการยืมอุปกรณ์ใหม่ | Create new loan record
  async create(data: {
    itemName?: string;
    description?: string;
    quantity: number;
    expectedReturnDate?: string;
    userId: number;
    borrowerName?: string;
    borrowerDepartment?: string;
    borrowerPhone?: string;
    borrowerLineId?: string;
  }) {
    return await this.prisma.loan.create({
      data: {
        itemName: data.itemName || '',
        description: data.description || '',
        quantity: data.quantity,
        borrowDate: new Date(),
        expectedReturnDate: data.expectedReturnDate ? new Date(data.expectedReturnDate) : null,
        status: 'BORROWED',
        userId: data.userId,
        borrowerName: data.borrowerName || '',
        borrowerDepartment: data.borrowerDepartment || '',
        borrowerPhone: data.borrowerPhone || '',
        borrowerLineId: data.borrowerLineId || '',
      },
      include: {
        borrowedBy: {
          select: { id: true, name: true, email: true, department: true, phoneNumber: true, lineId: true },
        },
      },
    });
  }

  // ดึงข้อมูลรายการยืมทั้งหมด (รองรับการกรองตามรายชื่อผู้ใช้) | Get all loan records with optional user filter
  async findAll(userId?: number | null) {
    const where = userId ? { userId } : {};
    return await this.prisma.loan.findMany({
      where,
      include: {
        borrowedBy: {
          select: { id: true, name: true, email: true, department: true, phoneNumber: true, lineId: true },
        },
      },
      orderBy: { borrowDate: 'desc' },
    });
  }

  // ดึงข้อมูลการยืมตาม ID | Find loan record by ID
  async findOne(id: number) {
    return await this.prisma.loan.findUnique({
      where: { id },
      include: {
        borrowedBy: {
          select: { id: true, name: true, email: true, department: true, phoneNumber: true, lineId: true },
        },
      },
    });
  }

  // อัปเดตข้อมูลการยืม/คืน | Update loan information or return status
  async update(
    id: number,
    data: {
      status?: string;
      returnDate?: string;
      itemName?: string;
      description?: string;
      quantity?: number;
      expectedReturnDate?: string;
      borrowerName?: string;
      borrowerDepartment?: string;
      borrowerPhone?: string;
      borrowerLineId?: string;
    },
  ) {
    const updateData: Prisma.LoanUpdateInput = {};
    if (data.status !== undefined) updateData.status = data.status as LoanStatus;
    if (data.returnDate !== undefined) updateData.returnDate = data.returnDate ? new Date(data.returnDate) : null;
    if (data.itemName !== undefined) updateData.itemName = data.itemName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.quantity !== undefined) updateData.quantity = data.quantity;
    if (data.expectedReturnDate !== undefined) updateData.expectedReturnDate = new Date(data.expectedReturnDate);
    if (data.borrowerName !== undefined) updateData.borrowerName = data.borrowerName;
    if (data.borrowerDepartment !== undefined) updateData.borrowerDepartment = data.borrowerDepartment;
    if (data.borrowerPhone !== undefined) updateData.borrowerPhone = data.borrowerPhone;
    if (data.borrowerLineId !== undefined) updateData.borrowerLineId = data.borrowerLineId;

    try {
      const result = await this.prisma.loan.update({
        where: { id },
        data: updateData,
        include: {
          borrowedBy: {
            select: { id: true, name: true, email: true, department: true, phoneNumber: true, lineId: true },
          },
        },
      });

      return result;
    } catch (error: unknown) {
      this.logger.error(`Error updating loan ${id}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  // ตรวจสอบข้อมูลการยืมที่เกินกำหนดคืน | Check and update overdue loans
  async checkOverdue() {
    const now = new Date();
    
    // Performance: Use updateMany for batch update instead of individual updates
    await this.prisma.loan.updateMany({
      where: {
        status: 'BORROWED',
        expectedReturnDate: {
          lt: now,
        },
      },
      data: { status: 'OVERDUE' },
    });

    return await this.prisma.loan.findMany({
      where: {
        status: 'OVERDUE',
        expectedReturnDate: {
          lt: now,
        },
      },
    });
  }

  // ลบข้อมูลการยืมออกจากระบบ | Delete loan record
  async delete(id: number) {
    try {
      const result = await this.prisma.loan.delete({
        where: { id },
      });
      return result;
    } catch (error: unknown) {
      this.logger.error(`Error deleting loan ${id}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
