// ===== จัดการแผนก | Department Management Service =====
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  // สร้างรายการแผนกใหม่ | Create new department
  async create(createDepartmentDto: CreateDepartmentDto) {
    const existingCode = await this.prisma.department.findUnique({
      where: { code: createDepartmentDto.code },
    });
    if (existingCode) {
      throw new ConflictException('รหัสแผนกซ้ำ');
    }

    return this.prisma.department.create({
      data: createDepartmentDto,
    });
  }

  // ดึงข้อมูลรายการแผนกทั้งหมด | Get all departments
  async findAll() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
    });
  }

  // ดึงข้อมูลแผนกตาม ID | Find department by ID
  async findOne(id: number) {
    const department = await this.prisma.department.findUnique({
      where: { id },
    });
    if (!department) {
      throw new NotFoundException(`Department with ID ${id} not found`);
    }
    return department;
  }

  // อัปเดตข้อมูลแผนก | Update department info
  async update(id: number, updateDepartmentDto: UpdateDepartmentDto) {
    await this.findOne(id); // Ensure exists

    if (updateDepartmentDto.code) {
      const existingCode = await this.prisma.department.findUnique({
        where: { code: updateDepartmentDto.code },
      });
      if (existingCode && existingCode.id !== id) {
        throw new ConflictException('Department code already exists');
      }
    }

    return this.prisma.department.update({
      where: { id },
      data: updateDepartmentDto,
    });
  }

  // ลบแผนกออกจากระบบ | Delete department
  async remove(id: number) {
    await this.findOne(id); // Ensure exists
    return this.prisma.department.delete({
      where: { id },
    });
  }
}
