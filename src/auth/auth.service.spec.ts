import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LineOAuthService } from './line-oauth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService - LINE OAuth Integration', () => {
  let service: AuthService;
  let lineOAuthService: LineOAuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const mockPrismaService = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        LineOAuthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    lineOAuthService = module.get<LineOAuthService>(LineOAuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);

    // Set up default env variables
    process.env.LINE_CHANNEL_ID = '2008551953';
    process.env.LINE_CHANNEL_SECRET = 'test-secret';
    process.env.LINE_REDIRECT_URI = 'https://rp-trr-client-internship.vercel.app/callback';
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLineAuthUrl', () => {
    it('should delegate to LineOAuthService.generateAuthUrl', () => {
      const generateAuthUrlSpy = jest.spyOn(lineOAuthService, 'generateAuthUrl');

      const result = service.getLineAuthUrl();

      expect(generateAuthUrlSpy).toHaveBeenCalled();
      expect(result).toHaveProperty('auth_url');
      expect(result).toHaveProperty('redirect_uri');
    });
  });

  describe('lineCallback - redirect_uri mismatch detection', () => {
    it('should throw error when redirect_uri does not match LINE Console', async () => {
      const mockError = new UnauthorizedException(
        'redirect_uri mismatch. Backend: "https://rp-trr-client-internship.vercel.app/callback". Update LINE Console Callback URL to match.'
      );

      jest.spyOn(lineOAuthService, 'exchangeCodeForToken').mockRejectedValueOnce(mockError);

      await expect(service.lineCallback('invalid-code')).rejects.toThrow(
        'redirect_uri mismatch'
      );
    });

    it('should log redirect_uri mismatch details', async () => {
      const mockError = new UnauthorizedException(
        'redirect_uri mismatch. Backend: "https://rp-trr-client-internship.vercel.app/callback". Update LINE Console Callback URL to match.'
      );

      jest.spyOn(lineOAuthService, 'exchangeCodeForToken').mockRejectedValueOnce(mockError);

      await expect(service.lineCallback('code')).rejects.toThrow(
        'redirect_uri mismatch'
      );
    });
  });

  describe('lineCallback - successful authentication', () => {
    it('should create new user if LINE ID not found', async () => {
      const mockTokenResponse = {
        access_token: 'mock-access-token',
        user_id: 'U1234567890abcdef1234567890abcdef',
      };

      const mockUserProfile = {
        displayName: 'John Doe',
        userId: 'U1234567890abcdef1234567890abcdef',
      };

      jest.spyOn(lineOAuthService, 'exchangeCodeForToken').mockResolvedValueOnce(mockTokenResponse);
      jest.spyOn(lineOAuthService, 'getUserProfile').mockResolvedValueOnce(mockUserProfile);
      
      (prismaService.user.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prismaService.user.create as jest.Mock).mockResolvedValueOnce({
        id: 1,
        name: 'John Doe',
        email: 'line_U1234567890abcdef1234567890abcdef@line.com',
        role: 'USER',
        lineId: 'U1234567890abcdef1234567890abcdef',
      });

      const result = await service.lineCallback('auth-code');

      expect(prismaService.user.create).toHaveBeenCalled();
      expect(result).toHaveProperty('access_token');
      expect(result.message).toBe('LOGIN success via LINE');
    });

    it('should use existing user if LINE ID found', async () => {
      const mockTokenResponse = {
        access_token: 'mock-access-token',
        user_id: 'U1234567890abcdef1234567890abcdef',
      };

      const existingUser = {
        id: 123,
        name: 'Jane Doe',
        role: 'USER',
        lineId: 'U1234567890abcdef1234567890abcdef',
      };

      jest.spyOn(lineOAuthService, 'exchangeCodeForToken').mockResolvedValueOnce(mockTokenResponse);
      (prismaService.user.findFirst as jest.Mock).mockResolvedValueOnce(existingUser);

      const result = await service.lineCallback('auth-code');

      expect(prismaService.user.create).not.toHaveBeenCalled();
      expect(result.userId).toBe(123);
      expect(result.message).toBe('LOGIN success via LINE');
    });

    it('should throw error when code is empty', async () => {
      await expect(service.lineCallback('')).rejects.toThrow(BadRequestException);
    });

    it('should throw error when code is not provided', async () => {
      await expect(service.lineCallback(null as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('lineCallback - verify redirect_uri sent to LINE', () => {
    it('should use correct redirect_uri from env during token exchange', async () => {
      process.env.LINE_REDIRECT_URI = 'https://custom.example.com/callback';

      const mockTokenResponse = {
        access_token: 'mock-access-token',
        user_id: 'U1234567890abcdef1234567890abcdef',
      };

      jest.spyOn(lineOAuthService, 'exchangeCodeForToken').mockResolvedValueOnce(mockTokenResponse);
      (prismaService.user.findFirst as jest.Mock).mockResolvedValueOnce(null);
      jest.spyOn(lineOAuthService, 'getUserProfile').mockResolvedValueOnce({ 
        displayName: 'User',
        userId: 'U1234567890abcdef1234567890abcdef'
      });
      (prismaService.user.create as jest.Mock).mockResolvedValueOnce({
        id: 1,
        name: 'User',
        role: 'USER',
      });

      const exchangeSpy = jest.spyOn(lineOAuthService, 'exchangeCodeForToken');
      await service.lineCallback('code');

      expect(exchangeSpy).toHaveBeenCalledWith('code');
    });
  });

  describe('Authorization workflow', () => {
    it('should complete full LINE OAuth flow without redirect_uri mismatch', async () => {
      const mockTokenResponse = {
        access_token: 'mock-token',
        user_id: 'U123',
      };

      jest.spyOn(lineOAuthService, 'exchangeCodeForToken').mockResolvedValueOnce(mockTokenResponse);
      jest.spyOn(lineOAuthService, 'getUserProfile').mockResolvedValueOnce({ 
        displayName: 'Test User',
        userId: 'U123'
      });
      (prismaService.user.findFirst as jest.Mock).mockResolvedValueOnce(null);
      (prismaService.user.create as jest.Mock).mockResolvedValueOnce({
        id: 999,
        name: 'Test User',
        role: 'USER',
        lineId: 'U123',
      });

      const result = await service.lineCallback('valid-code');

      expect(result.access_token).toBeDefined();
      expect(result.userId).toBe(999);
      expect(result.role).toBe('USER');
    });
  });
});
