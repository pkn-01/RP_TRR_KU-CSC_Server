import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';

export interface LineAuthUrlResponse {
  auth_url: string;
  client_id: string;
  redirect_uri: string;
  state: string;
}

export interface LineCallbackResponse {
  access_token: string;
  user_id: string;
}

export interface LineUserProfile {
  displayName: string;
  userId: string;
  pictureUrl?: string;
  statusMessage?: string;
}

@Injectable()
export class LineOAuthService {
  private readonly logger = new Logger(LineOAuthService.name);
  private readonly lineAuthEndpoint = 'https://access.line.me/oauth2/v2.1/authorize';
  private readonly lineTokenEndpoint = 'https://api.line.me/oauth2/v2.1/token';
  private readonly lineTokenInfoEndpoint = 'https://api.line.me/v2/oauth/tokeninfo';
  private readonly lineProfileEndpoint = 'https://api.line.me/v2/profile';

  constructor() {}

  // สร้าง LINE OAuth Authorization URL สำหรับการล็อกอิน
  generateAuthUrl(): LineAuthUrlResponse {
    const clientId = process.env.LINE_CHANNEL_ID || '';
    const redirectUri = this.getRedirectUri();
    const state = this.generateState();

    if (!clientId) {
      throw new Error('LINE credentials not configured: LINE_CHANNEL_ID is missing');
    }

    const authUrl = new URL(this.lineAuthEndpoint);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('scope', 'profile openid');

    this.logger.log('Generated LINE authorization URL');

    return {
      auth_url: authUrl.toString(),
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    };
  }

  // แลก Authorization Code เป็น Access Token
  async exchangeCodeForToken(code: string): Promise<LineCallbackResponse> {
    const clientId = process.env.LINE_CHANNEL_ID || '';
    const clientSecret = process.env.LINE_CHANNEL_SECRET || '';
    const redirectUri = this.getRedirectUri();

    if (!clientId || !clientSecret) {
      throw new Error('LINE credentials not configured');
    }

    this.logger.log('Exchanging authorization code for access token');

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    try {
      const response = await fetch(this.lineTokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenParams.toString(),
      });

      const responseData = await response.json();

      if (!response.ok) {
        this.logger.error(`TOKEN EXCHANGE FAILED - HTTP ${response.status}: ${responseData.error || 'Unknown'}`);

        // ตรวจสอบ redirect_uri mismatch
        if ((responseData.error === 'invalid_grant' || responseData.error === 'invalid_request') && 
            responseData.error_description && 
            responseData.error_description.toLowerCase().includes('redirect_uri')) {
          this.logger.error(`REDIRECT_URI MISMATCH - Backend: ${redirectUri}`);
          throw new UnauthorizedException(
            `redirect_uri mismatch. ` +
            `Backend is using: "${redirectUri}". ` +
            `Make sure LINE_REDIRECT_URI environment variable matches your LINE Console Callback URL exactly.`
          );
        }

        // ตรวจสอบ code_verifier/code_challenge mismatch (PKCE)
        if (responseData.error === 'invalid_grant' && 
            responseData.error_description && 
            responseData.error_description.toLowerCase().includes('code_verifier')) {
          throw new UnauthorizedException(
            `Authorization code expired or invalid. Please try logging in again.`
          );
        }

        throw new UnauthorizedException(
          `LINE API error: ${responseData.error || 'Unknown error'} - ${responseData.error_description || ''}. (Used redirect_uri: ${redirectUri})`
        );
      }

      this.logger.log('Token exchange successful');
      return {
        access_token: responseData.access_token,
        user_id: responseData.user_id,
      };
    } catch (error: any) {
      this.logger.error(`Error exchanging code: ${error.message}`);
      throw error instanceof UnauthorizedException 
        ? error 
        : new UnauthorizedException(`Failed to authenticate with LINE: ${error.message}`);
    }
  }

  // ดึง LINE User ID จาก Access Token
  async getUserId(accessToken: string): Promise<string> {
    try {
      const response = await fetch(this.lineTokenInfoEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          access_token: accessToken,
        }).toString(),
      });

      if (!response.ok) {
        throw new UnauthorizedException('Failed to verify LINE access token');
      }

      const data = await response.json();
      if (!data.user_id) {
        throw new UnauthorizedException('No user_id in LINE token response');
      }

      return data.user_id;
    } catch (error: any) {
      this.logger.error(`Error getting LINE user ID: ${error.message}`);
      throw error instanceof UnauthorizedException 
        ? error 
        : new UnauthorizedException('Failed to get LINE user ID');
    }
  }

  // ดึงข้อมูลโปรไฟล์ LINE ของผู้ใช้
  async getUserProfile(accessToken: string): Promise<LineUserProfile> {
    try {
      const response = await fetch(this.lineProfileEndpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        this.logger.warn('Failed to get LINE profile, using default');
        return { displayName: 'LINE User', userId: '' };
      }

      return await response.json();
    } catch (error) {
      this.logger.error('Error getting LINE profile');
      return { displayName: 'LINE User', userId: '' };
    }
  }

  // ตรวจสอบว่า redirect_uri ถูกตั้งค่าอย่างถูกต้อง
  verifyRedirectUri(): boolean {
    const redirectUri = process.env.LINE_REDIRECT_URI;
    
    if (!redirectUri) {
      this.logger.warn('LINE_REDIRECT_URI not configured in .env');
      return false;
    }

    if (!redirectUri.startsWith('https://')) {
      this.logger.warn('redirect_uri must use https://');
      return false;
    }

    return true;
  }

  // ดึง Redirect URI จาก Environment Variable
  private getRedirectUri(): string {
    let redirectUri = process.env.LINE_REDIRECT_URI;

    if (!redirectUri && process.env.FRONTEND_URL) {
      redirectUri = `${process.env.FRONTEND_URL}/auth/line/callback`;
    }

    if (!redirectUri && (process.env.NODE_ENV === 'production' || !process.env.NODE_ENV)) {
      redirectUri = 'https://qa-rp-trr-ku-csc.vercel.app/auth/line/callback';
    }

    if (!redirectUri) {
      redirectUri = 'http://localhost:3000/auth/line/callback';
    }

    if (!redirectUri.startsWith('https://') && !redirectUri.startsWith('http://')) {
      throw new Error(
        `LINE_REDIRECT_URI must use https:// or http:// protocol. Got: ${redirectUri}`
      );
    }

    return redirectUri;
  }

  private generateState(): string {
    return Math.random().toString(36).substring(7);
  }
}
