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
        message: 'Register success',
        userId: user.id,
        role: user.role,
      };
    } catch (error: any) {
      // Handle duplicate email error
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        throw new BadRequestException('Email already exists');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Email or password incorrect');
    }

    // SECURITY: Always use bcrypt.compare - Never compare plain text passwords
    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Email or password incorrect');
    }

    const payload = {
      sub: user.id,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      userId: user.id,
      role: user.role,
      message: 'Login success',
    };
  }

  /**
   * Get LINE OAuth authorization URL
   * Delegates to LineOAuthService
   */
  getLineAuthUrl() {
    return this.lineOAuth.generateAuthUrl();
  }

  /**
   * Handle LINE OAuth callback
   * Exchanges authorization code for access token and creates/updates user
   */
  async lineCallback(code: string, state?: string) {
    if (!code) {
      console.error('[LINE Auth] No authorization code provided');
      throw new BadRequestException('Authorization code is required');
    }
    
    this.logger.log('[LINE Auth] Processing callback');
    try {
      // Step 1: Exchange authorization code for access token
      const tokenResponse = await this.lineOAuth.exchangeCodeForToken(code);
      const lineAccessToken = tokenResponse.access_token;
      const lineUserId = tokenResponse.user_id;



      // Step 3: Check if user exists
      let user = await this.prisma.user.findFirst({
        where: {
          lineOALink: {
            lineUserId: lineUserId,
          },
        },
      });

      // If user doesn't exist, create a new user
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
        this.logger.log(`[LINE Auth] New user created: ${user.id}`);
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

      // Step 5: Generate JWT token

      const payload = {
        sub: user.id,
        role: user.role,
      };

      const result = {
        access_token: this.jwtService.sign(payload),
        userId: user.id,
        role: user.role,
        message: 'LOGIN success via LINE',
      };

      this.logger.log(`[LINE Auth] Authentication successful for user ${user.id}`);
      return result;
    } catch (error: any) {
      this.logger.error('[LINE Auth] Callback error:', error.message);
      throw error;
    }
  }


  async getProfile(userId: number) {
    try {
      if (!userId || typeof userId !== 'number') {
        throw new BadRequestException('Invalid user ID');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          department: true,
          phoneNumber: true,
          lineId: true,
          profilePicture: true,
          createdAt: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return user;
    } catch (error: any) {
      this.logger.error('Error in getProfile:', error.message);
      throw error;
    }
  }

  async updateProfile(userId: number, data: { name?: string; department?: string; phoneNumber?: string; lineId?: string }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.department && { department: data.department }),
        ...(data.phoneNumber && { phoneNumber: data.phoneNumber }),
        ...(data.lineId && { lineId: data.lineId }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        phoneNumber: true,
        lineId: true,
        profilePicture: true,
        createdAt: true,
      },
    });

    return user;
  }

  async uploadProfilePicture(userId: number, file: Express.Multer.File) {
    // Get current user to check for existing profile picture
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profilePictureId: true },
    });

    // Delete old profile picture from Cloudinary if exists
    if (currentUser?.profilePictureId) {
      try {
        await this.cloudinary.deleteFile(currentUser.profilePictureId);
      } catch (error) {
        console.error('Error deleting old profile picture:', error);
      }
    }

    // Upload new profile picture
    const uploadResult = await this.cloudinary.uploadFile(
      file.buffer,
      file.originalname,
      'profile-pictures',
    );

    // Update user with new profile picture
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
        department: true,
        phoneNumber: true,
        lineId: true,
        profilePicture: true,
        createdAt: true,
      },
    });

    return user;
  }

  /**
   * Get LINE User ID from Authorization Code
   * Used for Account Linking process
   */
  async getLineUserIdFromCode(code: string): Promise<string> {
    const tokenResponse = await this.lineOAuth.exchangeCodeForToken(code);
    
    // LINE token endpoint doesn't always return user_id
    // We need to fetch the profile using the access token
    if (!tokenResponse.user_id) {
      const profile = await this.lineOAuth.getUserProfile(tokenResponse.access_token);
      return profile.userId;
    }
    
    return tokenResponse.user_id;
  }
}

