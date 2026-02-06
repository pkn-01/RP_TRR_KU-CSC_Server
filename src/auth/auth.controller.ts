import { Controller, Post, Body, Get, Patch, Request, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Public()
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('line-auth-url')
  @Public()
  getLineAuthUrl() {
    return this.authService.getLineAuthUrl();
  }

  // 🔴 DEBUG: Check what redirect_uri is actually being used on Vercel
  @Get('debug-redirect-uri')
  @Public()
  debugRedirectUri() {
    const redirectUri = process.env.LINE_REDIRECT_URI;
    return {
      LINE_REDIRECT_URI: redirectUri,
      hasTrailingSlash: redirectUri?.endsWith('/'),
      message: 'This should match LINE Console Callback URL exactly',
    };
  }

  @Post('line-callback')
  @Public()
  async lineCallback(@Body() dto: { code: string; state?: string }) {
    return this.authService.lineCallback(dto.code, dto.state);
  }

  @Get('profile')
  getProfile(@Request() req) {
    console.log('Getting profile for user:', req.user);
    if (!req.user || !req.user.id) {
      throw new BadRequestException('User information not found in request');
    }
    return this.authService.getProfile(req.user.id);
  }

  @Patch('profile')
  updateProfile(
    @Request() req,
    @Body() data: { name?: string; department?: string; phoneNumber?: string; lineId?: string },
  ) {
    return this.authService.updateProfile(req.user.id, data);
  }

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

  @Post('verify-line-code')
  @Public()
  async verifyLineCode(@Body() body: { code: string }) {
    const lineUserId = await this.authService.getLineUserIdFromCode(body.code);
    return { lineUserId };
  }
}

