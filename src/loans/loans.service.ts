import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LoansService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    itemName: string;
    description?: string;
    quantity: number;
    expectedReturnDate: string;
    userId: number;
    borrowerName?: string;
    borrowerDepartment?: string;
    borrowerPhone?: string;
    borrowerLineId?: string;
  }) {
    return await this.prisma.loan.create({
      data: {
        itemName: data.itemName,
        description: data.description || '',
        quantity: data.quantity,
        borrowDate: new Date(),
        expectedReturnDate: new Date(data.expectedReturnDate),
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
    console.log(`[LoansService.update] Starting update for loan ${id}`);
    console.log(`[LoansService.update] Input data:`, data);
    
    const updateData: any = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.returnDate !== undefined) updateData.returnDate = data.returnDate ? new Date(data.returnDate) : null;
    if (data.itemName !== undefined) updateData.itemName = data.itemName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.quantity !== undefined) updateData.quantity = data.quantity;
    if (data.expectedReturnDate !== undefined) updateData.expectedReturnDate = new Date(data.expectedReturnDate);
    if (data.borrowerName !== undefined) updateData.borrowerName = data.borrowerName;
    if (data.borrowerDepartment !== undefined) updateData.borrowerDepartment = data.borrowerDepartment;
    if (data.borrowerPhone !== undefined) updateData.borrowerPhone = data.borrowerPhone;
    if (data.borrowerLineId !== undefined) updateData.borrowerLineId = data.borrowerLineId;

    console.log(`[LoansService.update] Prepared updateData:`, JSON.stringify(updateData, null, 2));

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

      console.log(`[LoansService.update] Loan ${id} updated successfully:`, JSON.stringify(result, null, 2));
      return result;
    } catch (error: unknown) {
      console.error(`[LoansService.update] Error updating loan ${id}:`, error);
      throw error;
    }
  }

  async checkOverdue() {
    const now = new Date();
    const overdueLoans = await this.prisma.loan.findMany({
      where: {
        status: 'BORROWED',
        expectedReturnDate: {
          lt: now,
        },
      },
    });

    // Update status to OVERDUE
    for (const loan of overdueLoans) {
      await this.prisma.loan.update({
        where: { id: loan.id },
        data: { status: 'OVERDUE' },
      });
    }

    return overdueLoans;
  }

  async delete(id: number) {
    console.log(`[LoansService.delete] Deleting loan ${id}`);
    try {
      const result = await this.prisma.loan.delete({
        where: { id },
      });
      console.log(`[LoansService.delete] Loan ${id} deleted successfully`);
      return result;
    } catch (error: unknown) {
      console.error(`[LoansService.delete] Error deleting loan ${id}:`, error);
      throw error;
    }
  }
}
