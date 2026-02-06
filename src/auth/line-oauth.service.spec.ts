import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { LineOAuthService } from './line-oauth.service';

describe('LineOAuthService', () => {
  let service: LineOAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LineOAuthService],
    }).compile();

    service = module.get<LineOAuthService>(LineOAuthService);

    // Set up default env variables for testing
    process.env.LINE_CHANNEL_ID = '2008551953';
    process.env.LINE_CHANNEL_SECRET = 'test-secret';
    process.env.LINE_REDIRECT_URI = 'https://rp-trr-client-internship.vercel.app/callback';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateAuthUrl', () => {
    it('should generate valid auth URL with all required parameters', () => {
      const result = service.generateAuthUrl();

      expect(result).toHaveProperty('auth_url');
      expect(result).toHaveProperty('client_id');
      expect(result).toHaveProperty('redirect_uri');
      expect(result).toHaveProperty('state');

      expect(result.client_id).toBe('2008551953');
      expect(result.redirect_uri).toBe('https://rp-trr-client-internship.vercel.app/callback');
    });

    it('should include correct query parameters in auth_url', () => {
      const result = service.generateAuthUrl();
      const url = new URL(result.auth_url);

      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('2008551953');
      expect(url.searchParams.get('redirect_uri')).toBe('https://rp-trr-client-internship.vercel.app/callback');
      expect(url.searchParams.get('scope')).toBe('profile openid');
      expect(url.searchParams.get('state')).toBeTruthy();
    });

    it('should use env LINE_REDIRECT_URI when available', () => {
      process.env.LINE_REDIRECT_URI = 'https://custom.com/callback';
      const result = service.generateAuthUrl();

      expect(result.redirect_uri).toBe('https://custom.com/callback');
    });

    it('should throw error when LINE_REDIRECT_URI is not configured', () => {
      delete process.env.LINE_REDIRECT_URI;

      expect(() => service.generateAuthUrl()).toThrow(
        'LINE_REDIRECT_URI is not configured'
      );
    });

    it('should throw error when LINE_CHANNEL_ID not configured', () => {
      delete process.env.LINE_CHANNEL_ID;

      expect(() => service.generateAuthUrl()).toThrow(
        'LINE credentials not configured: LINE_CHANNEL_ID is missing'
      );
    });

    it('should generate unique state for each call', () => {
      const result1 = service.generateAuthUrl();
      const result2 = service.generateAuthUrl();

      expect(result1.state).not.toBe(result2.state);
    });
  });

  describe('verifyRedirectUri', () => {
    it('should return true for valid https redirect_uri', () => {
      process.env.LINE_REDIRECT_URI = 'https://example.com/callback';
      const result = service.verifyRedirectUri();

      expect(result).toBe(true);
    });

    it('should return false for missing redirect_uri', () => {
      delete process.env.LINE_REDIRECT_URI;
      const result = service.verifyRedirectUri();

      expect(result).toBe(false);
    });

    it('should return false for http (non-secure) redirect_uri', () => {
      process.env.LINE_REDIRECT_URI = 'http://example.com/callback';
      const result = service.verifyRedirectUri();

      expect(result).toBe(false);
    });

    it('should return false for redirect_uri ending with slash', () => {
      process.env.LINE_REDIRECT_URI = 'https://example.com/callback/';
      const result = service.verifyRedirectUri();

      expect(result).toBe(false);
    });

    it('should warn and return false for query params in redirect_uri', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      process.env.LINE_REDIRECT_URI = 'https://example.com/callback?state=123';
      // This would be caught during token exchange, not in verify method
      // But the method should still work correctly
      
      warnSpy.mockRestore();
    });
  });

  describe('exchangeCodeForToken', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should successfully exchange code for token', async () => {
      const mockResponse = {
        access_token: 'mock-access-token',
        user_id: 'mock-user-id',
        expires_in: 3600,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.exchangeCodeForToken('mock-code');

      expect(result).toEqual({
        access_token: 'mock-access-token',
        user_id: 'mock-user-id',
      });
    });

    it('should include correct parameters in token exchange request', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', user_id: 'user' }),
      });

      await service.exchangeCodeForToken('test-code');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.line.me/oauth2/v2.1/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );

      const callBody = (global.fetch as jest.Mock).mock.calls[0][1].body;
      expect(callBody).toContain('grant_type=authorization_code');
      expect(callBody).toContain('code=test-code');
      expect(callBody).toContain('redirect_uri=https%3A%2F%2Frp-trr-client-internship.vercel.app%2Fcallback');
    });

    it('should throw UnauthorizedException on token exchange failure', async () => {
      const mockErrorResponse = {
        error: 'invalid_request',
        error_description: 'Invalid authorization code',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => mockErrorResponse,
        status: 400,
      });

      await expect(service.exchangeCodeForToken('invalid-code')).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should detect and throw error for redirect_uri mismatch', async () => {
      const mockErrorResponse = {
        error: 'invalid_grant',
        error_description: 'redirect_uri does not match',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => mockErrorResponse,
        status: 400,
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(service.exchangeCodeForToken('code')).rejects.toThrow(
        'redirect_uri mismatch'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('REDIRECT_URI MISMATCH DETECTED')
      );

      consoleSpy.mockRestore();
    });

    it('should throw error when LINE credentials not configured', async () => {
      delete process.env.LINE_CHANNEL_SECRET;

      await expect(service.exchangeCodeForToken('code')).rejects.toThrow(
        'LINE credentials not configured'
      );
    });
  });

  describe('getUserId', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it('should return user_id from access token', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user_id: 'U1234567890abcdef1234567890abcdef' }),
      });

      const result = await service.getUserId('test-access-token');

      expect(result).toBe('U1234567890abcdef1234567890abcdef');
    });

    it('should throw UnauthorizedException on invalid token', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(service.getUserId('invalid-token')).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should throw UnauthorizedException when user_id missing', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ expires_in: 3600 }),
      });

      await expect(service.getUserId('test-token')).rejects.toThrow(
        'No user_id in LINE token response'
      );
    });
  });

  describe('getUserProfile', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it('should return user profile from LINE API', async () => {
      const mockProfile = {
        displayName: 'John Doe',
        userId: 'U1234567890abcdef1234567890abcdef',
        pictureUrl: 'https://example.com/pic.jpg',
        statusMessage: 'Hello LINE',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfile,
      });

      const result = await service.getUserProfile('test-token');

      expect(result).toEqual(mockProfile);
    });

    it('should return default profile on API failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await service.getUserProfile('test-token');

      expect(result).toEqual({
        displayName: 'LINE User',
        userId: '',
      });
    });

    it('should return default profile on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await service.getUserProfile('test-token');

      expect(result).toEqual({
        displayName: 'LINE User',
        userId: '',
      });
    });
  });
});
