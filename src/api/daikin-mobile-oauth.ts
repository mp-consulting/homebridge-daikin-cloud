/**
 * Daikin Mobile OAuth Client
 *
 * Handles OAuth 2.0 authentication using the mobile app flow (Gigya + PKCE).
 * Provides:
 * - 3000 API calls/day (vs 200 for Developer Portal)
 * - WebSocket access for real-time device updates
 * - Automatic token refresh
 */

import * as crypto from 'node:crypto';
import type { TokenSet, MobileClientConfig } from './daikin-types';
import { DAIKIN_MOBILE_CONFIG } from './daikin-types';
import {
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from '../constants';
import { loadTokenFromFile, saveTokenToFile, deleteTokenFile } from './token-storage';
import { httpRequest } from './http-transport';

interface PKCEPair {
    verifier: string;
    challenge: string;
}

interface GigyaLoginResult {
    errorCode: number;
    errorMessage?: string;
    errorDetails?: string;
    regToken?: string;
    data?: { profile?: Record<string, string> };
    profile?: { firstName?: string; lastName?: string };
    sessionInfo?: {
        login_token: string;
    };
}

export class DaikinMobileOAuth {
  private tokenSet: TokenSet | null = null;
  private refreshPromise: Promise<TokenSet> | null = null;
  private cookies = '';

  constructor(
        private readonly config: MobileClientConfig,
        private readonly onTokenUpdate?: (tokenSet: TokenSet) => void,
        private readonly onError?: (error: Error) => void,
        private readonly onLog?: (message: string) => void,
  ) {
    this.loadFromFile();
  }

  /**
     * Authenticate with email and password using mobile app flow.
     * Returns tokens with WebSocket access and 5000/day rate limit.
     */
  async authenticate(): Promise<TokenSet> {
    const pkce = this.generatePKCE();

    // Step 1: Get OIDC context
    const context = await this.getOidcContext(pkce);

    // Step 2: Initialize Gigya SDK (get cookies)
    this.cookies = await this.initGigyaSdk(context);

    // Step 3: Login with Gigya
    const loginToken = await this.gigyaLogin();

    // Step 4: Exchange for authorization code
    const code = await this.authorizeWithToken(context, loginToken);

    // Step 5: Exchange code for tokens at IDP
    const tokenSet = await this.exchangeCodeForTokens(code, pkce);

    this.setTokenSet(tokenSet);
    return tokenSet;
  }

  /**
     * Refresh the access token
     */
  async refreshToken(): Promise<TokenSet> {
    if (!this.tokenSet?.refresh_token) {
      throw new Error('No refresh token available');
    }

    // Prevent concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefresh();

    try {
      const tokenSet = await this.refreshPromise;
      this.setTokenSet(tokenSet);
      return tokenSet;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performRefresh(): Promise<TokenSet> {
    const basicAuth = Buffer.from(
      DAIKIN_MOBILE_CONFIG.clientId + ':' + DAIKIN_MOBILE_CONFIG.clientSecret,
    ).toString('base64');

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.tokenSet!.refresh_token!,
    });

    const response = await this.httpsRequest(
      DAIKIN_MOBILE_CONFIG.idpTokenEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + basicAuth,
        },
      },
      params.toString(),
    );

    const result = this.parseJsonResponse<TokenSet & { error?: string; error_description?: string }>(
      response, DAIKIN_MOBILE_CONFIG.idpTokenEndpoint, 'Token refresh failed',
    );

    if (result.error) {
      throw new Error('Token refresh failed: ' + (result.error_description || result.error));
    }

    return result;
  }

  /**
     * Get a valid access token, refreshing if necessary
     */
  async getAccessToken(): Promise<string> {
    if (!this.tokenSet) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    // Check if token is expired or about to expire (10 second buffer)
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = this.tokenSet.expires_at || 0;

    if (expiresAt < now + 10) {
      if (!this.tokenSet.refresh_token) {
        throw new Error('Token expired and no refresh token available. Please re-authenticate.');
      }
      await this.refreshToken();
    }

    return this.tokenSet!.access_token;
  }

  /**
     * Check if we have a valid token
     */
  isAuthenticated(): boolean {
    return this.tokenSet !== null && !!this.tokenSet.access_token;
  }

  /**
     * Get token expiration date
     */
  getTokenExpiration(): Date | null {
    if (!this.tokenSet?.expires_at) {
      return null;
    }
    return new Date(this.tokenSet.expires_at * 1000);
  }

  /**
     * Get current token set (for status display)
     */
  getTokenSet(): TokenSet | null {
    return this.tokenSet;
  }

  /**
     * Clear stored tokens
     */
  clearTokens(): void {
    this.deleteFile();
    this.tokenSet = null;
  }

  // =========================================================================
  // Private authentication methods
  // =========================================================================

  private get gigyaPostHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://id.daikin.eu',
      'Referer': 'https://id.daikin.eu/',
      'Cookie': this.cookies,
    };
  }

  private get gigyaSdkParams(): Record<string, string> {
    return {
      targetEnv: 'jssdk',
      include: 'profile,data,emails,subscriptions,preferences,',
      APIKey: DAIKIN_MOBILE_CONFIG.apiKey,
      source: 'showScreenSet',
      sdk: 'js_latest',
      authMode: 'cookie',
      pageURL: 'https://id.daikin.eu/cdc/onecta/oidc/registration-login.html?gig_client_id=' + DAIKIN_MOBILE_CONFIG.clientId,
      sdkBuild: '18305',
      format: 'json',
    };
  }

  private extractLoginToken(result: GigyaLoginResult, context: string): string {
    if (result.errorCode !== 0) {
      throw new Error(context + ' (' + result.errorCode + '): '
        + (result.errorMessage || result.errorDetails));
    }

    if (!result.sessionInfo?.login_token) {
      throw new Error('No login_token in ' + context + ' response');
    }

    return result.sessionInfo.login_token;
  }

  private generatePKCE(): PKCEPair {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  private async getOidcContext(pkce: PKCEPair): Promise<string> {
    const params = new URLSearchParams({
      client_id: DAIKIN_MOBILE_CONFIG.clientId,
      redirect_uri: DAIKIN_MOBILE_CONFIG.redirectUri,
      response_type: 'code',
      scope: DAIKIN_MOBILE_CONFIG.scope,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state: crypto.randomBytes(16).toString('hex'),
    });

    const oidcBase = DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/oidc/op/v1.0/' + DAIKIN_MOBILE_CONFIG.apiKey;
    const url = oidcBase + '/authorize?' + params;

    const response = await this.httpsRequest(url, { method: 'GET' });

    if (response.statusCode === 302 && response.headers.location) {
      const location = response.headers.location as string;
      const contextMatch = location.match(/context=([^&]+)/);
      if (contextMatch) {
        return decodeURIComponent(contextMatch[1]);
      }
    }

    throw new Error('Failed to get OIDC context');
  }

  private async initGigyaSdk(context: string): Promise<string> {
    const proxyUrl = 'https://id.daikin.eu/cdc/onecta/oidc/proxy.html?context=' + encodeURIComponent(context) + '&client_id=' + DAIKIN_MOBILE_CONFIG.clientId + '&mode=login&scope=' + encodeURIComponent(DAIKIN_MOBILE_CONFIG.scope) + '&gig_skipConsent=true';

    const params = new URLSearchParams({
      apiKey: DAIKIN_MOBILE_CONFIG.apiKey,
      pageURL: proxyUrl,
      sdk: 'js_latest',
      sdkBuild: '18305',
      format: 'json',
    });

    const response = await this.httpsRequest(
      DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/accounts.webSdkBootstrap?' + params,
      {
        method: 'GET',
        headers: {
          'Accept': '*/*',
          'Origin': 'https://id.daikin.eu',
          'Referer': 'https://id.daikin.eu/',
        },
      },
    );

    // Extract cookies
    const cookies: string[] = [];
    const setCookies = response.headers['set-cookie'];
    if (setCookies) {
      const cookieArray = Array.isArray(setCookies) ? setCookies : [setCookies];
      for (const cookie of cookieArray) {
        const match = cookie.match(/^([^=]+=[^;]+)/);
        if (match) {
          cookies.push(match[1]);
        }
      }
    }
    cookies.push('gig_bootstrap_' + DAIKIN_MOBILE_CONFIG.apiKey + '=cdc_ver4');

    return cookies.join('; ');
  }

  private generateRiskContext(): string {
    const now = new Date();
    const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
    return JSON.stringify({
      b0: 14063,
      b1: [0, 2, 2, 0],
      b2: 4,
      b3: [],
      b4: 2,
      b5: 1,
      b6: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
      b7: [],
      b8: timeStr,
      b9: 0,
      b10: { state: 'denied' },
      b11: false,
      b12: null,
      b13: [5, '402|874|24', false, true],
    });
  }

  private async gigyaLogin(): Promise<string> {
    const params = new URLSearchParams({
      ...this.gigyaSdkParams,
      loginID: this.config.email,
      password: this.config.password,
      sessionExpiration: '31536000',
      includeUserInfo: 'true',
      loginMode: 'standard',
      lang: 'en',
      riskContext: this.generateRiskContext(),
    });

    const response = await this.httpsRequest(
      DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/accounts.login',
      { method: 'POST', headers: this.gigyaPostHeaders },
      params.toString(),
    );

    const result = this.parseJsonResponse<GigyaLoginResult>(
      response, DAIKIN_MOBILE_CONFIG.gigyaBaseUrl, 'Login failed',
    );

    if (result.errorCode === 206001) {
      this.onLog?.('Account has pending registration (206001). Attempting to complete registration automatically...');
      if (result.sessionInfo?.login_token) {
        return result.sessionInfo.login_token;
      }
      if (result.regToken) {
        return await this.completePendingRegistration(result.regToken, result.data, result.profile);
      }
    }

    return this.extractLoginToken(result, 'Login failed');
  }

  private async completePendingRegistration(
    regToken: string,
    existingData?: { profile?: Record<string, string> },
    existingProfile?: { firstName?: string; lastName?: string },
  ): Promise<string> {
    const customProfile = existingData?.profile || {};
    const countryResidence = customProfile.countryResidence || 'US';
    const communicationLanguage = customProfile.communicationLanguage || 'en';

    // Use existing name fields, or derive from email as last resort
    let firstName = existingProfile?.firstName;
    let lastName = existingProfile?.lastName;

    if (!firstName || !lastName) {
      const emailUser = this.config.email.split('@')[0];
      const nameParts = emailUser.split(/[._-]/);
      firstName = firstName || (nameParts[0]
        ? nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1)
        : 'User');
      lastName = lastName || (nameParts.length > 1
        ? nameParts[nameParts.length - 1].charAt(0).toUpperCase() + nameParts[nameParts.length - 1].slice(1)
        : 'Account');
      this.onLog?.('Using derived name for registration: ' + firstName + ' ' + lastName
        + '. You can update your name in the Daikin Onecta app.');
    }

    this.onLog?.('Completing pending registration with countryResidence=' + countryResidence
      + ', communicationLanguage=' + communicationLanguage);
    this.onLog?.('Note: Privacy notice consent (privacy.PrivacyNotice.onecta) will be accepted automatically.');

    const params = new URLSearchParams({
      ...this.gigyaSdkParams,
      regToken,
      email: this.config.email,
      password: this.config.password,
      profile: JSON.stringify({ firstName, lastName }),
      data: JSON.stringify({ profile: { countryResidence, communicationLanguage } }),
      preferences: JSON.stringify({
        'privacy.PrivacyNotice.onecta': { isConsentGranted: true },
      }),
      finalizeRegistration: 'true',
    });

    const response = await this.httpsRequest(
      DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/accounts.register',
      { method: 'POST', headers: this.gigyaPostHeaders },
      params.toString(),
    );

    const result = this.parseJsonResponse<GigyaLoginResult>(
      response, DAIKIN_MOBILE_CONFIG.gigyaBaseUrl, 'Registration completion failed',
    );
    const loginToken = this.extractLoginToken(result, 'Registration completion failed');

    this.onLog?.('Pending registration completed successfully.');
    return loginToken;
  }

  private async authorizeWithToken(context: string, loginToken: string): Promise<string> {
    const params = new URLSearchParams({
      context: context,
      login_token: loginToken,
    });

    const cookieStr = this.cookies + '; glt_' + DAIKIN_MOBILE_CONFIG.apiKey + '=' + loginToken;
    const oidcBase = DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/oidc/op/v1.0/' + DAIKIN_MOBILE_CONFIG.apiKey;
    const url = oidcBase + '/authorize/continue?' + params;

    const response = await this.httpsRequest(url, {
      method: 'GET',
      headers: {
        'Cookie': cookieStr,
        'Referer': 'https://id.daikin.eu/',
      },
    });

    if (response.statusCode === 302 && response.headers.location) {
      const location = response.headers.location as string;
      const codeMatch = location.match(/code=([^&]+)/);
      if (codeMatch) {
        return codeMatch[1];
      }

      const errorMatch = location.match(/error=([^&]+)/);
      if (errorMatch) {
        const errorDesc = location.match(/error_description=([^&]+)/);
        throw new Error('Authorization error: ' + decodeURIComponent(errorDesc ? errorDesc[1] : errorMatch[1]));
      }
    }

    throw new Error('Failed to get authorization code');
  }

  private async exchangeCodeForTokens(code: string, pkce: PKCEPair): Promise<TokenSet> {
    const basicAuth = Buffer.from(
      DAIKIN_MOBILE_CONFIG.clientId + ':' + DAIKIN_MOBILE_CONFIG.clientSecret,
    ).toString('base64');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: DAIKIN_MOBILE_CONFIG.redirectUri,
      code_verifier: pkce.verifier,
    });

    const response = await this.httpsRequest(
      DAIKIN_MOBILE_CONFIG.idpTokenEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + basicAuth,
        },
      },
      params.toString(),
    );

    const result = this.parseJsonResponse<TokenSet & { error?: string; error_description?: string }>(
      response, DAIKIN_MOBILE_CONFIG.idpTokenEndpoint, 'Token exchange failed',
    );

    if (result.error) {
      throw new Error('Token exchange failed: ' + (result.error_description || result.error));
    }

    return result;
  }

  // =========================================================================
  // Token storage methods
  // =========================================================================

  private setTokenSet(tokenSet: TokenSet): void {
    if (tokenSet.expires_in && !tokenSet.expires_at) {
      tokenSet.expires_at = Math.floor(Date.now() / 1000) + tokenSet.expires_in;
    }

    this.tokenSet = tokenSet;
    this.saveToFile();

    if (this.onTokenUpdate) {
      this.onTokenUpdate(tokenSet);
    }
  }

  private loadFromFile(): void {
    try {
      this.tokenSet = loadTokenFromFile(this.config.tokenFilePath);
    } catch (error) {
      if (this.onError) {
        this.onError(new Error('Failed to load token file: ' + (error as Error).message));
      }
    }
  }

  private saveToFile(): void {
    try {
      if (this.tokenSet) {
        saveTokenToFile(this.config.tokenFilePath, this.tokenSet);
      }
    } catch (error) {
      if (this.onError) {
        this.onError(new Error('Failed to save token file: ' + (error as Error).message));
      }
    }
  }

  private deleteFile(): void {
    deleteTokenFile(this.config.tokenFilePath);
  }

  // =========================================================================
  // HTTP helper
  // =========================================================================

  /**
     * Network-level failures where no HTTP response was ever received. These are
     * worth retrying: a silently dropped packet, a host that is still booting its
     * network stack, or a flaky DNS resolver all look like this.
     */
  private static readonly RETRYABLE_ERROR_CODES = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
  ]);

  /**
     * Parse a JSON response body, reporting the endpoint and status instead of a
     * bare "Unexpected end of JSON input" when a proxy/WAF answers with HTML or
     * with nothing at all.
     */
  private parseJsonResponse<T>(
    response: { statusCode: number; body: string },
    url: string,
    context: string,
  ): T {
    try {
      return JSON.parse(response.body) as T;
    } catch {
      const { hostname } = new URL(url);
      const snippet = response.body.trim().slice(0, 200);
      throw new Error(
        `${context}: ${hostname} returned a non-JSON response (HTTP ${response.statusCode})`
        + (snippet ? `: ${snippet}` : ' with an empty body'),
      );
    }
  }

  private isRetryableNetworkError(error: NodeJS.ErrnoException): boolean {
    return !!error.code && DaikinMobileOAuth.RETRYABLE_ERROR_CODES.has(error.code);
  }

  /**
     * Turn a bare socket error into something a user can act on. The generic
     * "timed out after 30000ms" gave no hint about which host was unreachable.
     */
  private describeNetworkError(error: NodeJS.ErrnoException, url: string): Error {
    const { hostname } = new URL(url);
    const reason = error.code ? `${error.message} (${error.code})` : error.message;

    if (!this.isRetryableNetworkError(error)) {
      return new Error(`Request to ${hostname} failed: ${reason}`);
    }

    return new Error(
      `Request to ${hostname} failed after ${MAX_RETRY_ATTEMPTS} attempts: ${reason}. `
      + `The Homebridge host could not get a response from https://${hostname}. `
      + 'Verify it is reachable from this host (curl -v), and check for firewall/DNS filtering, '
      + 'broken IPv6 connectivity or a low-MTU link — the Daikin endpoints themselves are usually fine.',
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
     * Perform a request, retrying transient network failures with exponential backoff.
     */
  private async httpsRequest(
    url: string,
    options: { method: string; headers?: Record<string, string> },
    postData?: string,
  ): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.performHttpsRequest(url, options, postData);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;

        if (attempt >= MAX_RETRY_ATTEMPTS || !this.isRetryableNetworkError(err)) {
          throw this.describeNetworkError(err, url);
        }

        const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
        this.onLog?.(`Request to ${new URL(url).hostname} failed (${err.code}); retrying in ${delay}ms `
          + `(attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`);
        await this.sleep(delay);
      }
    }
  }

  private performHttpsRequest(
    url: string,
    options: { method: string; headers?: Record<string, string> },
    postData?: string,
  ): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
    return httpRequest(url, { method: options.method, headers: options.headers }, postData);
  }
}
