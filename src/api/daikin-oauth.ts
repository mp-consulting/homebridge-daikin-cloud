/**
 * Daikin OAuth Client
 *
 * Handles OAuth 2.0 authentication with the Daikin Cloud API.
 */

import * as crypto from 'node:crypto';
import type { TokenSet, DaikinClientConfig } from './daikin-types';
import { DAIKIN_OIDC_CONFIG } from './daikin-types';
import { httpRequest, type TransportResponse } from './http-transport';
import { TokenClient, parseTokenResponse, withExpiresAt } from './token-client';

export class DaikinOAuth extends TokenClient {
  constructor(
        private readonly config: DaikinClientConfig,
        onTokenUpdate?: (tokenSet: TokenSet) => void,
        onError?: (error: Error) => void,
  ) {
    super(config.tokenFilePath, onTokenUpdate, onError);
  }

  // =========================================================================
  // Static utility methods (for use by homebridge-ui)
  // =========================================================================

  /**
     * Build authorization URL (static version)
     */
  static buildAuthUrlStatic(clientId: string, redirectUri: string, state: string): string {
    const url = new URL(DAIKIN_OIDC_CONFIG.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', DAIKIN_OIDC_CONFIG.scope);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /**
     * Exchange authorization code for tokens (static version)
     */
  static async exchangeCodeStatic(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<TokenSet> {
    const tokenSet = await DaikinOAuth.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }, 'Authorization code exchange failed');
    return withExpiresAt(tokenSet);
  }

  /**
     * Revoke token (static version)
     */
  static async revokeTokenStatic(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
  ): Promise<void> {
    const response = await DaikinOAuth.postForm(DAIKIN_OIDC_CONFIG.revokeEndpoint, {
      token: refreshToken,
      token_type_hint: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Token revocation failed: HTTP ${response.statusCode}`);
    }
  }

  /**
     * POST to the token endpoint and validate the token response
     */
  private static async requestToken(params: Record<string, string>, context: string): Promise<TokenSet> {
    const response = await DaikinOAuth.postForm(DAIKIN_OIDC_CONFIG.tokenEndpoint, params);
    return parseTokenResponse(response, DAIKIN_OIDC_CONFIG.tokenEndpoint, context);
  }

  /**
     * POST a form-encoded body
     */
  private static postForm(url: string, params: Record<string, string>): Promise<TransportResponse> {
    return httpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, new URLSearchParams(params).toString());
  }

  // =========================================================================
  // Instance methods
  // =========================================================================

  /**
     * Get the redirect URI for OAuth
     */
  getRedirectUri(): string {
    return `https://${this.config.callbackServerExternalAddress}:${this.config.callbackServerPort}`;
  }

  /**
     * Build the authorization URL
     */
  buildAuthUrl(state?: string): { url: string; state: string } {
    const authState = state || crypto.randomBytes(32).toString('hex');
    const url = new URL(DAIKIN_OIDC_CONFIG.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.getRedirectUri());
    url.searchParams.set('scope', DAIKIN_OIDC_CONFIG.scope);
    url.searchParams.set('state', authState);
    return { url: url.toString(), state: authState };
  }

  /**
     * Exchange authorization code for tokens
     */
  async exchangeCode(code: string): Promise<TokenSet> {
    const tokenSet = await DaikinOAuth.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri(),
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    }, 'Authorization code exchange failed');
    return this.setTokenSet(tokenSet);
  }

  /**
     * Revoke the current token. The local token file is deleted even when the
     * revocation request fails.
     */
  async revokeToken(): Promise<void> {
    const refreshToken = this.tokenSet?.refresh_token;
    if (!refreshToken) {
      return;
    }

    try {
      await DaikinOAuth.revokeTokenStatic(refreshToken, this.config.clientId, this.config.clientSecret);
    } catch {
      // Ignore revocation errors: the local logout must still happen
    }

    this.clearTokens();
  }

  protected requestTokenRefresh(refreshToken: string): Promise<TokenSet> {
    return DaikinOAuth.requestToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    }, 'Token refresh failed');
  }
}
