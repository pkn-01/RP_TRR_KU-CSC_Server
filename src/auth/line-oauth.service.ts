import { Injectable, UnauthorizedException } from '@nestjs/common';

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
  private readonly lineAuthEndpoint = 'https://access.line.me/oauth2/v2.1/authorize';
  private readonly lineTokenEndpoint = 'https://api.line.me/oauth2/v2.1/token';
  private readonly lineTokenInfoEndpoint = 'https://api.line.me/v2/oauth/tokeninfo';
  private readonly lineProfileEndpoint = 'https://api.line.me/v2/profile';

  constructor() {}

  /**
   * Generate LINE OAuth authorization URL
   * @returns LineAuthUrlResponse containing auth_url, client_id, redirect_uri, and state
   */
  generateAuthUrl(): LineAuthUrlResponse {
    const clientId = process.env.LINE_CHANNEL_ID || '';
    const redirectUri = this.getRedirectUri();
    const state = this.generateState();

    // Debug: Verify env variables are loaded
    this.logDebug('LINE LOGIN DEBUG', {
      channelId: process.env.LINE_CHANNEL_ID,
      redirectUri: process.env.LINE_REDIRECT_URI,
    });

    if (!clientId) {
      throw new Error('LINE credentials not configured: LINE_CHANNEL_ID is missing');
    }

    const authUrl = new URL(this.lineAuthEndpoint);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('scope', 'profile openid');

    console.log('[LINE Auth] Generated authorization URL:', {
      clientId,
      redirectUri,
      state: state.substring(0, 5) + '...',
    });
    this.logDebug('LINE LOGIN DEBUG', { finalRedirectUri: redirectUri });

    return {
      auth_url: authUrl.toString(),
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    };
  }

  /**
   * Exchange authorization code for access token
   * @throws UnauthorizedException if exchange fails
   */
  async exchangeCodeForToken(code: string): Promise<LineCallbackResponse> {
    const clientId = process.env.LINE_CHANNEL_ID || '';
    const clientSecret = process.env.LINE_CHANNEL_SECRET || '';
    const redirectUri = this.getRedirectUri();

    // Verify all env variables before token exchange
    this.logDebug('TOKEN EXCHANGE DEBUG', {
      clientId,
      redirectUri,
      clientSecretExists: !!clientSecret,
    });

    if (!clientId || !clientSecret) {
      throw new Error('LINE credentials not configured');
    }

    console.log('[LINE Auth] Exchanging authorization code for access token');
    console.log('[LINE Auth] Using redirect_uri:', redirectUri);

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    // 🔴 DEBUG: Log exact params being sent to LINE API
    console.log('[LINE Auth] 🔴 DETAILED TOKEN EXCHANGE DEBUG:');
    console.log('[LINE Auth] grant_type:', 'authorization_code');
    console.log('[LINE Auth] code:', code.substring(0, 20) + '...');
    console.log('[LINE Auth] redirect_uri:', redirectUri);
    console.log('[LINE Auth] client_id:', clientId);
    console.log('[LINE Auth] client_secret:', clientSecret.substring(0, 10) + '...');
    console.log('[LINE Auth] Sending to:', this.lineTokenEndpoint);

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
        console.error('[LINE Auth] ❌ TOKEN EXCHANGE FAILED');
        console.error('[LINE Auth] HTTP Status:', response.status);
        console.error('[LINE Auth] Error response:', JSON.stringify(responseData, null, 2));
        console.error('[LINE Auth] Token params sent:', {
          grant_type: 'authorization_code',
          code: code.substring(0, 20) + '...',
          redirect_uri: redirectUri,
          client_id: clientId,
        });

        // ✅ Check for redirect_uri mismatch specifically
        // This is the most common OAuth error - frontend and backend using different redirect URIs
        if ((responseData.error === 'invalid_grant' || responseData.error === 'invalid_request') && 
            responseData.error_description && 
            responseData.error_description.toLowerCase().includes('redirect_uri')) {
          console.error('[LINE Auth] 🔴 REDIRECT_URI MISMATCH DETECTED!');
          console.error('[LINE Auth] Backend redirect_uri:', redirectUri);
          console.error('[LINE Auth] Expected by LINE Console: Check your LINE Console settings');
          console.error('[LINE Auth] Ensure LINE_REDIRECT_URI in .env matches LINE Console exactly');
          throw new UnauthorizedException(
            `redirect_uri mismatch. ` +
            `Backend is using: "${redirectUri}". ` +
            `Make sure LINE_REDIRECT_URI environment variable matches your LINE Console Callback URL exactly.`
          );
        }

        // ✅ Check for code_verifier/code_challenge mismatch (PKCE related)
        if (responseData.error === 'invalid_grant' && 
            responseData.error_description && 
            responseData.error_description.toLowerCase().includes('code_verifier')) {
          console.error('[LINE Auth] 🔴 CODE_VERIFIER MISMATCH - Authorization code may have expired');
          console.error('[LINE Auth] Try logging in again - authorization codes expire after 10 minutes');
          throw new UnauthorizedException(
            `Authorization code expired or invalid. Please try logging in again.`
          );
        }

        throw new UnauthorizedException(
          `LINE API error: ${responseData.error || 'Unknown error'} - ${responseData.error_description || ''}`
        );
      }

      console.log('[LINE Auth] ✅ Token exchange successful');
      return {
        access_token: responseData.access_token,
        user_id: responseData.user_id,
      };
    } catch (error: any) {
      console.error('[LINE Auth] Error exchanging code:', error.message);
      throw error instanceof UnauthorizedException 
        ? error 
        : new UnauthorizedException(`Failed to authenticate with LINE: ${error.message}`);
    }
  }

  /**
   * Get LINE user ID from access token
   * @throws UnauthorizedException if token verification fails
   */
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
      console.error('[LINE Auth] Error getting LINE user ID:', error.message);
      throw error instanceof UnauthorizedException 
        ? error 
        : new UnauthorizedException('Failed to get LINE user ID');
    }
  }

  /**
   * Get LINE user profile information
   * @returns LineUserProfile or default profile if request fails
   */
  async getUserProfile(accessToken: string): Promise<LineUserProfile> {
    try {
      const response = await fetch(this.lineProfileEndpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        console.warn('[LINE Auth] Failed to get LINE profile, using default');
        return { displayName: 'LINE User', userId: '' };
      }

      return await response.json();
    } catch (error) {
      console.error('[LINE Auth] Error getting LINE profile:', error);
      return { displayName: 'LINE User', userId: '' };
    }
  }

  /**
   * Verify that redirect_uri matches what's configured in env
   * @returns true if redirect_uri is properly configured
   */
  verifyRedirectUri(): boolean {
    const redirectUri = process.env.LINE_REDIRECT_URI;
    
    if (!redirectUri) {
      console.warn('[LINE Auth] LINE_REDIRECT_URI not configured in .env');
      return false;
    }

    // Basic validation
    if (!redirectUri.startsWith('https://')) {
      console.warn('[LINE Auth] redirect_uri must use https://');
      return false;
    }

    // Allow redirect URIs both with and without trailing slash
    // but prefer explicit configuration in environment variables

    return true;
  }

  /**
   * Private helper methods
   */

  private getRedirectUri(): string {
    const redirectUri = process.env.LINE_REDIRECT_URI;

    // ✅ CRITICAL: Do NOT use fallback value
    // redirect_uri MUST be explicitly configured in environment
    if (!redirectUri) {
      throw new Error(
        'LINE_REDIRECT_URI is not configured. ' +
        'Set LINE_REDIRECT_URI in environment variables. ' +
        'It must match exactly with LINE Console Callback URL.'
      );
    }

    // ✅ Validate redirect_uri protocol
    if (!redirectUri.startsWith('https://') && !redirectUri.startsWith('http://')) {
      throw new Error(
        `LINE_REDIRECT_URI must use https:// or http:// protocol. Got: ${redirectUri}`
      );
    }

    // ✅ CRITICAL: Return EXACTLY as configured - no normalization!
    // The redirect_uri MUST match byte-for-byte with LINE Console Callback URL.
    // Do NOT add or remove trailing slash - use exactly what's in env.
    console.log('[LINE Auth] Using redirect_uri exactly as configured:', redirectUri);
    return redirectUri;
  }

  private generateState(): string {
    return Math.random().toString(36).substring(7);
  }

  private logDebug(label: string, data: Record<string, any>): void {
    console.log(`[🔴 ${label}] ==========================================`);
    Object.entries(data).forEach(([key, value]) => {
      console.log(`[🔴 ${label}] ${key}:`, value);
    });
    console.log(`[🔴 ${label}] ==========================================`);
  }
}
