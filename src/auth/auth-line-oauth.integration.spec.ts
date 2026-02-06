import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LineOAuthService } from './line-oauth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('LINE OAuth Integration - Redirect URI Verification', () => {
  let app: INestApplication;
  let authService: AuthService;
  let lineOAuthService: LineOAuthService;

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

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
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

    app = moduleFixture.createNestApplication();
    await app.init();

    authService = moduleFixture.get<AuthService>(AuthService);
    lineOAuthService = moduleFixture.get<LineOAuthService>(LineOAuthService);

    // Set up environment
    process.env.LINE_CHANNEL_ID = '2008551953';
    process.env.LINE_CHANNEL_SECRET = 'test-secret';
    process.env.LINE_REDIRECT_URI = 'https://rp-trr-client-internship.vercel.app/callback';
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  describe('getLineAuthUrl endpoint returns correct redirect_uri', () => {
    it('should return auth URL with matching redirect_uri from env', () => {
      const result = authService.getLineAuthUrl();

      expect(result.redirect_uri).toBe('https://rp-trr-client-internship.vercel.app/callback');
      expect(result.auth_url).toContain('redirect_uri=https%3A%2F%2Frp-trr-client-internship.vercel.app%2Fcallback');
    });

    it('should not send hardcoded redirect_uri', () => {
      process.env.LINE_REDIRECT_URI = 'https://different-domain.com/callback';
      const result = authService.getLineAuthUrl();

      expect(result.redirect_uri).toBe('https://different-domain.com/callback');
      expect(result.auth_url).toContain('https%3A%2F%2Fdifferent-domain.com%2Fcallback');
    });
  });

  describe('Token exchange includes correct redirect_uri', () => {
    it('should send redirect_uri parameter in token exchange request', async () => {
      global.fetch = jest.fn();

      const mockResponse = {
        access_token: 'mock-token',
        user_id: 'U123',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await lineOAuthService.exchangeCodeForToken('code');

      const callBody = (global.fetch as jest.Mock).mock.calls[0][1].body;
      expect(callBody).toContain('redirect_uri=https%3A%2F%2Frp-trr-client-internship.vercel.app%2Fcallback');
    });

    it('should NOT send query params in redirect_uri (would cause mismatch)', async () => {
      global.fetch = jest.fn();

      const mockResponse = {
        access_token: 'mock-token',
        user_id: 'U123',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await lineOAuthService.exchangeCodeForToken('code');

      const callBody = (global.fetch as jest.Mock).mock.calls[0][1].body;
      // Verify no query params are added
      expect(callBody).not.toContain('state=');
      expect(callBody).not.toContain('code=abc&redirect');
    });
  });

  describe('redirect_uri mismatch error detection', () => {
    it('should detect when LINE rejects with redirect_uri mismatch', async () => {
      global.fetch = jest.fn();

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'redirect_uri does not match registered',
        }),
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(lineOAuthService.exchangeCodeForToken('code')).rejects.toThrow(
        'redirect_uri mismatch'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/REDIRECT_URI MISMATCH DETECTED/)
      );

      consoleSpy.mockRestore();
    });

    it('should log actual backend redirect_uri in error message', async () => {
      global.fetch = jest.fn();

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'redirect_uri does not match',
        }),
      });

      await expect(lineOAuthService.exchangeCodeForToken('code')).rejects.toThrow(
        'redirect_uri mismatch'
      );
    });
  });

  describe('verifyRedirectUri validation method', () => {
    it('should validate secure HTTPS protocol', () => {
      process.env.LINE_REDIRECT_URI = 'https://example.com/callback';
      expect(lineOAuthService.verifyRedirectUri()).toBe(true);
    });

    it('should reject HTTP (insecure) protocol', () => {
      process.env.LINE_REDIRECT_URI = 'http://example.com/callback';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      expect(lineOAuthService.verifyRedirectUri()).toBe(false);

      warnSpy.mockRestore();
    });

    it('should reject trailing slash in redirect_uri', () => {
      process.env.LINE_REDIRECT_URI = 'https://example.com/callback/';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      expect(lineOAuthService.verifyRedirectUri()).toBe(false);

      warnSpy.mockRestore();
    });

    it('should reject missing redirect_uri', () => {
      delete process.env.LINE_REDIRECT_URI;
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      expect(lineOAuthService.verifyRedirectUri()).toBe(false);

      warnSpy.mockRestore();
    });
  });

  describe('Simulate complete OAuth flow with redirect_uri mismatch', () => {
    it('should handle scenario: env set correctly but LINE Console mismatch', async () => {
      // Backend has correct env
      process.env.LINE_REDIRECT_URI = 'https://rp-trr-client-internship.vercel.app/callback';

      // Simulate LINE rejects because Console has different URL
      global.fetch = jest.fn();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'redirect_uri does not match registered service',
        }),
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // User clicks login, gets auth URL
      const authUrl = authService.getLineAuthUrl();
      expect(authUrl.redirect_uri).toBe('https://rp-trr-client-internship.vercel.app/callback');

      // User goes to LINE, gets code, sends to backend
      await expect(authService.lineCallback('mock-code')).rejects.toThrow(
        'redirect_uri mismatch'
      );

      // Error message includes debugging info
      const errorLogs = consoleSpy.mock.calls.filter(call =>
        call[0]?.toString().includes('REDIRECT_URI MISMATCH')
      );

      expect(errorLogs.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });

    it('should NOT have mismatch when everything configured correctly', async () => {
      process.env.LINE_REDIRECT_URI = 'https://rp-trr-client-internship.vercel.app/callback';

      global.fetch = jest.fn();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'mock-token',
          user_id: 'U123',
        }),
      });

      const result = await lineOAuthService.exchangeCodeForToken('code');

      expect(result.access_token).toBe('mock-token');
      expect(result.user_id).toBe('U123');
    });
  });

  describe('Environment variable consistency check', () => {
    it('should use same redirect_uri in both generateAuthUrl and exchangeCodeForToken', async () => {
      const authUrl = authService.getLineAuthUrl();
      
      global.fetch = jest.fn();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token',
          user_id: 'U123',
        }),
      });

      await lineOAuthService.exchangeCodeForToken('code');

      const tokenExchangeBody = (global.fetch as jest.Mock).mock.calls[0][1].body;
      const bodyParams = new URLSearchParams(tokenExchangeBody);
      const tokenRedirectUri = bodyParams.get('redirect_uri');

      // Both should use same redirect_uri from env
      expect(authUrl.redirect_uri).toBe(tokenRedirectUri);
      expect(authUrl.redirect_uri).toBe('https://rp-trr-client-internship.vercel.app/callback');
    });
  });
});
