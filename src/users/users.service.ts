// ===== จัดการผู้ใช้ | User Management Service =====
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ดึงข้อมูลผู้ใช้ทั้งหมด (พร้อม Filter ตาม Role) 
  async getAllUsers(page: number = 1, limit: number = 10, roles?: string) {
    const skip = (page - 1) * limit;
    
    const where: Prisma.UserWhereInput = {};
    if (roles) {
      const rolesArray = roles.split(',').map(r => r.trim());
      where.role = { in: rolesArray as Role[] };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          phoneNumber: true,
          lineId: true,
          lineOALink: {
            select: {
              lineUserId: true,
              displayName: true,
              pictureUrl: true,
            }
          },
          profilePicture: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              repairTickets: true,
              repairAssignments: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // แปลงข้อมูลผู้ใช้ให้แบนราบ 
    const mappedUsers = users.map(user => this.mapUserLineInfo(user));

    return {
      data: mappedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ดึงรายชื่อเจ้าหน้าที่ IT และ Admin 
  async getITStaff() {
    return this.prisma.user.findMany({
      where: {
        role: {
          in: ['IT', 'ADMIN']
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        phoneNumber: true,
        lineId: true,
        lineOALink: {
          select: {
            lineUserId: true,
            displayName: true,
            pictureUrl: true
          }
        },
        profilePicture: true,
      },
      orderBy: {
        name: 'asc'
      }
    }).then(users => users.map(user => this.mapUserLineInfo(user)));
  }

  // ดึงข้อมูลผู้ใช้ตาม ID 
  async getUserById(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        // รหัสผ่านถูกลบออกจากการแสดงผล - ไม่ควรเปิดเผยต่อ API 
        role: true,
        department: true,
        phoneNumber: true,
        lineId: true,
        lineOALink: {
            select: {
                lineUserId: true,
                displayName: true,
                pictureUrl: true,
            }
        },
        profilePicture: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            repairTickets: true,
            repairAssignments: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return this.mapUserLineInfo(user);
  }

  // อัปเดตข้อมูลผู้ใช้ 
  async updateUser(id: number, data: any) {
    // ตรวจสอบว่าผู้ใช้มีอยู่จริงหรือไม่ 
    const userExists = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!userExists) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updateData: Prisma.UserUpdateInput = {};

    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.role) updateData.role = data.role;
    if (data.department) updateData.department = data.department;
    if (data.phoneNumber) updateData.phoneNumber = data.phoneNumber;
    if (data.lineId) updateData.lineId = data.lineId;
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        phoneNumber: true,
        lineId: true,
        lineOALink: {
            select: {
                lineUserId: true,
                displayName: true,
                pictureUrl: true,
            }
        },
        profilePicture: true,
        createdAt: true,
        updatedAt: true,
      },
    }).then(user => this.mapUserLineInfo(user));
  }

  // ลบผู้ใช้ออกจากระบบ 
  async deleteUser(id: number) {
    // ตรวจสอบว่าผู้ใช้มีอยู่จริงหรือไม่ 
    const userExists = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!userExists) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return this.prisma.user.delete({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }

  // ค้นหาผู้ใช้จากชื่อ, อีเมล, หรือข้อมูล LINE 
  async searchUsers(query: string) {
    return this.prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { department: { contains: query, mode: 'insensitive' } },
          { 
            lineOALink: { 
              OR: [
                { displayName: { contains: query, mode: 'insensitive' } },
                { lineUserId: { contains: query, mode: 'insensitive' } }
              ]
            } 
          }
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        phoneNumber: true,
        lineId: true,
        lineOALink: {
            select: {
                lineUserId: true,
                displayName: true,
                pictureUrl: true,
            }
        },
        profilePicture: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 10,
    }).then(users => users.map(user => this.mapUserLineInfo(user)));
  }

  // สร้างบัญชีผู้ใช้ใหม่ 
  async createUser(data: any) {
    const hashedPassword = await bcrypt.hash(data.password, 10);

    try {
      return await this.prisma.user.create({
        data: {
          name: data.name,
          email: data.email,
          password: hashedPassword,
          role: data.role || 'ผู้ใช้ทั่วไป',
          department: data.department || '',
          phoneNumber: data.phoneNumber || '',
          lineId: data.lineId || '',
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          phoneNumber: true,
          lineId: true,
          createdAt: true,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        throw new ConflictException('อีเมลนี้ถูกใช้งานแล้ว');
      }
      throw error;
    }
  }

  // เปลี่ยนรหัสผ่านผู้ใช้ 
  async changePassword(id: number, newPassword: string) {
    // ตรวจสอบว่าผู้ใช้มีอยู่จริงหรือไม่ 
    const userExists = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!userExists) {
      throw new NotFoundException(`ผู้ใช้ ${id} ไม่พบ`);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    return this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        phoneNumber: true,
        lineId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

 
  // ดึงหรือสร้างผู้ใช้ใหม่จากการล็อกอินผ่าน LINE 
  async getOrCreateUserFromLine(lineUserId: string, displayName?: string, pictureUrl?: string) {
    // 0. Explicit handle for Guest
    if (!lineUserId || lineUserId === 'Guest' || lineUserId.toLowerCase() === 'null') {
      return this.getOrCreateGuestUser();
    }

    // 1. ตรวจสอบว่า LineOALink มีอยู่จริงหรือไม่ 
    const existingLink = await this.prisma.lineOALink.findFirst({
      where: { lineUserId },
      include: { user: true },
    });

    if (existingLink) {
      // อัปเดตข้อมูลโปรไฟล์หากมีการเปลี่ยนแปลง 
      if (displayName && existingLink.displayName !== displayName || 
          pictureUrl && existingLink.pictureUrl !== pictureUrl) {
        await this.prisma.lineOALink.update({
          where: { id: existingLink.id },
          data: {
            displayName: displayName || existingLink.displayName,
            pictureUrl: pictureUrl || existingLink.pictureUrl,
          },
        });
      }
      return existingLink.user;
    }

    // 2. ถ้าเป็นผู้ใช้ใหม่
    const timestamp = Date.now();
    const systemEmail = `line-${lineUserId}@repair-system.local`; // System unique email
    
    // กำหนดชื่อ: ใช้ชื่อ LINE หากมี, มิฉะนั้นใช้ชื่อทั่วไป
    const registerName = displayName || `User ${lineUserId.substring(0, 6)}`;

    // Create user and link in one transaction
    const user = await this.prisma.user.create({
      data: {
        email: systemEmail,
        name: registerName,
        password: await bcrypt.hash(`temp_${lineUserId}`, 10),
        role: 'USER',
        lineOALink: {
          create: {
            lineUserId,
            displayName,
            pictureUrl,
            status: 'VERIFIED',
            verificationToken: '',
            verificationExpiry: null,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        // รหัสผ่านถูกลบออกจากการแสดงผล 
        role: true,
        department: true,
        phoneNumber: true,
        lineId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  /**
   * ดึงหรือสร้างผู้ใช้ชั่วคราวสำหรับการแจ้งซ่อมแบบไม่ระบุตัวตน 
   */
  async getOrCreateGuestUser() {
    const guestEmail = 'guest@repair-system.local';
    
    let guest = await this.prisma.user.findUnique({
      where: { email: guestEmail },
    });

    if (!guest) {
      const hashedPassword = await bcrypt.hash('guest_password', 10);
      guest = await this.prisma.user.create({
        data: {
          email: guestEmail,
          name: 'Guest User',
          password: hashedPassword,
          role: 'USER',
          department: 'General',
        },
      });
    }

    return guest;
  }

  /**
   * Private helper to map user and flatten LINE info
   */
  private mapUserLineInfo(user: any) {
    if (!user) return null;
    return {
      ...user,
      lineUserId: user.lineOALink?.lineUserId || user.lineId,
      displayName: user.lineOALink?.displayName,
      pictureUrl: user.lineOALink?.pictureUrl,
    };
  }
}

