// ===== ระบบยืนยันตัวตน=====
import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LineOAuthService } from './line-oauth.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private lineOAuth: LineOAuthService,
    private cloudinary: CloudinaryService,
  ) {}

  // ลงทะเบียนผู้ใช้ใหม่ 
  async register(dto: RegisterDto) {
    const hash = await bcrypt.hash(dto.password, 10);

    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hash,
          role: 'USER', // Always set to USER - admins manage roles
          department: dto.department,
          phoneNumber: dto.phoneNumber,
          lineId: dto.lineId,
        },
      });

      return {
        message: 'ลงทะเบียนสำเร็จ',
        userId: user.id,
        role: user.role,
      };
    } catch (error: any) {
      // ตรวจสอบ error
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        throw new BadRequestException('อีเมลถูกใช้แล้ว');
      }
      throw error;
    }
  }

  // ตรวจสอบการเข้าสู่ระบบและสร้าง JWT Token 
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    // ตรวจสอบรหัสผ่าน
    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    const payload = {
      sub: user.id,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      userId: user.id,
      role: user.role,
      message: 'เข้าสู่ระบบสำเร็จ',
    };
  }

  // ดึง URL สำหรับการยืนยันตัวตนผ่าน LINE
  getLineAuthUrl() {
    return this.lineOAuth.generateAuthUrl();
  }


  // จัดการ Callback จาก LINE และทำการ Login/Register อัตโนมัติ
  async lineCallback(code: string, state?: string) {
    if (!code) {
      this.logger.error('[LINE Auth] ไม่พบ authorization code');
      throw new BadRequestException('ไม่พบ authorization code');
    }
    
    this.logger.log('[LINE Auth] กำลังจัดการ callback');
    try {
      // Step 1: แลก authorization code ให้ access token
      const tokenResponse = await this.lineOAuth.exchangeCodeForToken(code);
      const lineAccessToken = tokenResponse.access_token;
      const lineUserId = tokenResponse.user_id;



      // Step 3: ตรวจสอบ user
      let user = await this.prisma.user.findFirst({
        where: {
          lineOALink: {
            lineUserId: lineUserId,
          },
        },
      });

        // ถ้าไม่มี user
      if (!user) {
        const lineProfile = await this.lineOAuth.getUserProfile(lineAccessToken);

        user = await this.prisma.user.create({
          data: {
            name: lineProfile.displayName || 'LINE User',
            email: `line_${lineUserId}@line.com`,
            password: await bcrypt.hash(Math.random().toString(36), 10),
            role: 'USER',
            lineId: lineUserId,
            lineOALink: {
              create: {
                lineUserId: lineUserId,
                status: 'VERIFIED',
              },
            },
          },
        });
        this.logger.log(`[LINE Auth] สร้างผู้ใช้ใหม่: ${user.id}`);
      } else {
        if (!user.lineId) {
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: {
              lineId: lineUserId,
            },
          });
        }
      }

      // Step 5: ส่ง JWT token

      const payload = {
        sub: user.id,
        role: user.role,
      };

      const result = {
        access_token: this.jwtService.sign(payload),
        userId: user.id,
        role: user.role,
        message: 'เข้าสู่ระบบสำเร็จผ่าน LINE',
      };

      this.logger.log(`[LINE Auth] การยืนยันตัวตนสำเร็จสำหรับผู้ใช้ ${user.id}`);
      return result;
    } catch (error: any) {
      this.logger.error('[LINE Auth] การยืนยันตัวตนผ่าน LINE ไม่สำเร็จ:', error.message);
      throw error;
    }
  }


  // ดึงโปรไฟล์ข้อมูลเบื้องต้นของผู้ใช้
  async getProfile(userId: number) {
    try {
      if (!userId || typeof userId !== 'number') {
        throw new BadRequestException('IDผู้ใช้ไม่ถูกต้อง');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          phoneNumber: true,
          profilePicture: true,
          createdAt: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('ไม่พบผู้ใช้');
      }

      return user;
    } catch (error: any) {
      this.logger.error('[ดึงโปรไฟล์ข้อมูลเบื้องต้นของผู้ใช้] เกิดข้อผิดพลาด:', error.message);
      throw error;
    }
  }

  // อัปเดตข้อมูลส่วนตัวผู้ใช้ 
  async updateProfile(userId: number, data: { name?: string; phoneNumber?: string; }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.phoneNumber && { phoneNumber: data.phoneNumber }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phoneNumber: true,
        profilePicture: true,
        createdAt: true,
      },
    });

    return user;
  }

  // อัปโหลดและเปลี่ยนแปลงรูปโปรไฟล์
  async uploadProfilePicture(userId: number, file: Express.Multer.File) {
    // Get current user to check for existing profile picture
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profilePictureId: true },
    });

    // ลบรูปโปรไฟล์เก่า
    if (currentUser?.profilePictureId) {
      try {
        await this.cloudinary.deleteFile(currentUser.profilePictureId);
      } catch (error) {
        this.logger.error('[อัปโหลดและเปลี่ยนแปลงรูปโปรไฟล์] เกิดข้อผิดพลาดในการลบรูปโปรไฟล์เก่า');
      }
    }

    // อัปโหลดรูปโปรไฟล์ใหม่
    const uploadResult = await this.cloudinary.uploadFile(
      file.buffer,
      file.originalname,
      'profile-pictures',
    );

    // อัปเดตผู้ใช้กับรูปโปรไฟล์ใหม่
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        profilePicture: uploadResult.url,
        profilePictureId: uploadResult.publicId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phoneNumber: true,
        profilePicture: true,
        createdAt: true,
      },
    });

    return user;
  }

  /**
   * ดึง LINE User ID จาก Authorization Code
   * ใช้สำหรับกระบวนการเชื่อมต่อบัญชี
   */
  async getLineUserIdFromCode(code: string): Promise<string> {
    const tokenResponse = await this.lineOAuth.exchangeCodeForToken(code);
    
    // ถ้าไม่มี user_id
    // ต้องดึง user_id จาก access token
    if (!tokenResponse.user_id) {
      const profile = await this.lineOAuth.getUserProfile(tokenResponse.access_token);
      return profile.userId;
    }
    
    return tokenResponse.user_id;
  }
}

