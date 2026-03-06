// ===== API ยืนยันตัวตน | Authentication Controller =====
import { Controller, Post, Body, Get, Patch, Request, BadRequestException, UseInterceptors, UploadedFile, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(private authService: AuthService) {}

  // ลงทะเบียนผู้ใช้ใหม่ | Register new user
  @Post('register')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // SECURITY: Stricter rate limit for public registration
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // เข้าสู่ระบบด้วย Email/Password | Login with email and password
  @Post('login')
  @Public()
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // ดึง URL สำหรับการล็อกอินผ่าน LINE | Get LINE Authentication URL
  @Get('line-auth-url')
  @Public()
  getLineAuthUrl() {
    try {
      return this.authService.getLineAuthUrl();
    } catch (error) {
      this.logger.error(`Error getting LINE Auth URL: ${error.message}`);
      throw new BadRequestException(error.message || 'Failed to generate LINE Auth URL');
    }
  }

  // SECURITY: debug-redirect-uri endpoint removed — was leaking env vars in production

  // รับ Callback จาก LINE เพื่อล็อกอินหรือสร้างบัญชี | Handle LINE OA OAuth callback
  @Post('line-callback')
  @Public()
  async lineCallback(@Body() dto: { code: string; state?: string }) {
    return this.authService.lineCallback(dto.code, dto.state);
  }

  // ดึงข้อมูลโปรไฟล์ของผู้ใช้ปัจจบัน | Get current user profile
  @Get('profile')
  getProfile(@Request() req) {
    if (!req.user || !req.user.id) {
      throw new BadRequestException('User information not found in request');
    }
    return this.authService.getProfile(req.user.id);
  }

  // อัปเดตข้อมูลโปรไฟล์ | Update user profile
  @Patch('profile')
  updateProfile(
    @Request() req,
    @Body() data: { name?: string; department?: string; phoneNumber?: string; lineId?: string },
  ) {
    return this.authService.updateProfile(req.user.id, data);
  }

  // อัปโหลดรูปโปรไฟล์ | Upload profile picture
  @Post('profile/picture')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePicture(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.authService.uploadProfilePicture(req.user.id, file);
  }

  // ตรวจสอบรหัสยืนยันจาก LINE (LIFF) | Verify LINE login code from LIFF
  @Post('verify-line-code')
  @Public()
  async verifyLineCode(@Body() body: { code: string }) {
    const lineUserId = await this.authService.getLineUserIdFromCode(body.code);
    return { lineUserId };
  }
}

