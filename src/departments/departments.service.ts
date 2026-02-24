import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async create(createDepartmentDto: CreateDepartmentDto) {
    const existingCode = await this.prisma.department.findUnique({
      where: { code: createDepartmentDto.code },
    });
    if (existingCode) {
      throw new ConflictException('Department code already exists');
    }

    return this.prisma.department.create({
      data: createDepartmentDto,
    });
  }

  async findAll() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const department = await this.prisma.department.findUnique({
      where: { id },
    });
    if (!department) {
      throw new NotFoundException(`Department with ID ${id} not found`);
    }
    return department;
  }

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

  async remove(id: number) {
    await this.findOne(id); // Ensure exists
    return this.prisma.department.delete({
      where: { id },
    });
  }
}
