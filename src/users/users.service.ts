import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getAllUsers(page: number = 1, limit: number = 10, roles?: string) {
    const skip = (page - 1) * limit;
    
    const where: any = {};
    if (roles) {
      const rolesArray = roles.split(',').map(r => r.trim());
      where.role = { in: rolesArray };
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
              tickets: true,
              assigned: true,
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

    // Map users to flatten LINE info
    const mappedUsers = users.map(user => ({
      ...user,
      lineUserId: user.lineOALink?.lineUserId || user.lineId,
      displayName: user.lineOALink?.displayName,
      pictureUrl: user.lineOALink?.pictureUrl,
    }));

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
    }).then(users => users.map(user => ({
      ...user,
      lineUserId: user.lineOALink?.lineUserId || user.lineId,
      displayName: user.lineOALink?.displayName,
      pictureUrl: user.lineOALink?.pictureUrl
    })));
  }

  async getUserById(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
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
            tickets: true,
            assigned: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return {
        ...user,
        lineUserId: user.lineOALink?.lineUserId || user.lineId,
        displayName: user.lineOALink?.displayName,
        pictureUrl: user.lineOALink?.pictureUrl,
    };
  }

  async updateUser(id: number, data: any) {
    // Check if user exists first
    const userExists = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!userExists) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updateData: any = {};

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
    }).then(user => ({
        ...user,
        lineUserId: user.lineOALink?.lineUserId || user.lineId,
        displayName: user.lineOALink?.displayName,
        pictureUrl: user.lineOALink?.pictureUrl,
    }));
  }

  async deleteUser(id: number) {
    // Check if user exists first
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
    }).then(users => users.map(user => ({
        ...user,
        lineUserId: user.lineOALink?.lineUserId || user.lineId,
        displayName: user.lineOALink?.displayName,
        pictureUrl: user.lineOALink?.pictureUrl
    })));
  }

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
        throw new ConflictException('Email already exists');
      }
      throw error;
    }
  }

  async changePassword(id: number, newPassword: string) {
    // Check if user exists first
    const userExists = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!userExists) {
      throw new NotFoundException(`User with ID ${id} not found`);
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

  /**
   * Get or create a User from LINE User ID (Upsert logic)
   * Uses real display name from LINE and syncs profile
   */
  async getOrCreateUserFromLine(lineUserId: string, displayName?: string, pictureUrl?: string) {
    // 0. Explicit handle for Guest
    if (!lineUserId || lineUserId === 'Guest' || lineUserId.toLowerCase() === 'null') {
      return this.getOrCreateGuestUser();
    }

    // 1. Check if LineOALink exists
    const existingLink = await this.prisma.lineOALink.findFirst({
      where: { lineUserId },
      include: { user: true },
    });

    if (existingLink) {
      // Update profile info if changed
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

    // 2. If new user
    const timestamp = Date.now();
    const systemEmail = `line-${lineUserId}@repair-system.local`; // System unique email
    
    // Determine name: Use LINE name if available, otherwise generic
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
        password: true,
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
   * Get or create a Guest user for anonymous repairs
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
}

