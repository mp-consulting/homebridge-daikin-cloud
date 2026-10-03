/**
 * Token Client
 *
 * Token lifecycle shared by both OAuth flows (Developer Portal and Mobile
 * App): persistence to the token file, expiry checks with a refresh buffer,
 * single-flight refresh, and strict parsing of token endpoint responses.
 */

import type { OAuthProvider, TokenSet } from './daikin-types';
import type { TransportResponse } from './http-transport';
import { OAuthErrorSchema, TokenSetSchema } from './daikin-schemas';
import { loadTokenFromFile, saveTokenToFile, deleteTokenFile } from './token-storage';
import { TOKEN_EXPIRY_BUFFER_SECONDS } from '../constants';
import { toMessage } from '../utils/errors';

type ResponseLike = Pick<TransportResponse, 'statusCode' | 'body'>;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Return a copy of the token set with `expires_at` derived from `expires_in`
 * when the server only sent the relative lifetime.
 */
export function withExpiresAt(tokenSet: TokenSet): TokenSet {
  if (tokenSet.expires_in && !tokenSet.expires_at) {
    return { ...tokenSet, expires_at: nowSeconds() + tokenSet.expires_in };
  }
  return tokenSet;
}

/**
 * Whether the token is expired or expires within TOKEN_EXPIRY_BUFFER_SECONDS.
 * A token without `expires_at` is treated as expired.
 */
export function isTokenExpiring(tokenSet: TokenSet): boolean {
  return (tokenSet.expires_at ?? 0) < nowSeconds() + TOKEN_EXPIRY_BUFFER_SECONDS;
}

/**
 * Parse a JSON response body, reporting the endpoint and status instead of a
 * bare "Unexpected token <" when a proxy/WAF answers with HTML or nothing.
 */
export function parseJsonBody(response: ResponseLike, url: string, context: string): unknown {
  try {
    return JSON.parse(response.body);
  } catch {
    const { hostname } = new URL(url);
    const snippet = response.body.trim().replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(
      `${context}: ${hostname} returned a non-JSON response (HTTP ${response.statusCode})`
      + (snippet ? `: ${snippet}` : ' with an empty body'),
    );
  }
}

/**
 * Validate a token endpoint response: OAuth error bodies, non-2xx statuses and
 * malformed token sets all become errors with a readable message. The message
 * keeps the OAuth error code (e.g. `invalid_grant`), which callers match on.
 * Token values are never included.
 */
export function parseTokenResponse(response: ResponseLike, url: string, context: string): TokenSet {
  const body = parseJsonBody(response, url, context);

  const oauthError = OAuthErrorSchema.safeParse(body);
  if (oauthError.success) {
    const { error, error_description: description } = oauthError.data;
    throw new Error(
      `${context}: ${error}${description ? ` - ${description}` : ''} (HTTP ${response.statusCode})`,
    );
  }

  const { hostname } = new URL(url);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${context}: ${hostname} returned HTTP ${response.statusCode}`);
  }

  const result = TokenSetSchema.safeParse(body);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(body)'))];
    throw new Error(
      `${context}: ${hostname} returned an invalid token response (missing or malformed: ${fields.join(', ')})`,
    );
  }
  return result.data;
}

/**
 * Base class holding the current token set and its refresh logic. Subclasses
 * implement only the grant-specific refresh request.
 */
export abstract class TokenClient implements OAuthProvider {
  protected tokenSet: TokenSet | null = null;
  private refreshPromise: Promise<TokenSet> | null = null;

  protected constructor(
    private readonly tokenFilePath: string,
    private readonly onTokenUpdate?: (tokenSet: TokenSet) => void,
    private readonly onError?: (error: Error) => void,
  ) {
    this.loadFromFile();
  }

  /**
   * Exchange a refresh token for a new token set at the provider.
   */
  protected abstract requestTokenRefresh(refreshToken: string): Promise<TokenSet>;

  /**
   * Refresh the access token. Concurrent callers share one in-flight request;
   * a failed refresh is not cached, so the next call retries.
   */
  refreshToken(): Promise<TokenSet> {
    const refreshToken = this.tokenSet?.refresh_token;
    if (!refreshToken) {
      return Promise.reject(new Error('No refresh token available'));
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.requestTokenRefresh(refreshToken)
        // Providers may omit refresh_token when they do not rotate it; the
        // previous one stays valid then (RFC 6749 section 6).
        .then((tokenSet) => this.setTokenSet({ ...tokenSet, refresh_token: tokenSet.refresh_token ?? refreshToken }))
        .finally(() => {
          this.refreshPromise = null;
        });
    }
    return this.refreshPromise;
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getAccessToken(): Promise<string> {
    const current = this.tokenSet;
    if (!current) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    if (!isTokenExpiring(current)) {
      return current.access_token;
    }

    if (!current.refresh_token) {
      throw new Error('Token expired and no refresh token available. Please re-authenticate.');
    }
    const refreshed = await this.refreshToken();
    return refreshed.access_token;
  }

  /**
   * Check if we have a token (it may still need a refresh)
   */
  isAuthenticated(): boolean {
    return !!this.tokenSet?.access_token;
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
   * Forget the current tokens and delete the token file
   */
  clearTokens(): void {
    deleteTokenFile(this.tokenFilePath);
    this.tokenSet = null;
  }

  /**
   * Store a new token set (in memory and on disk) and notify listeners.
   * Returns the stored set, with `expires_at` filled in.
   */
  protected setTokenSet(tokenSet: TokenSet): TokenSet {
    const stored = withExpiresAt(tokenSet);
    this.tokenSet = stored;
    this.saveToFile(stored);
    this.onTokenUpdate?.(stored);
    return stored;
  }

  private loadFromFile(): void {
    try {
      this.tokenSet = loadTokenFromFile(this.tokenFilePath);
    } catch (error) {
      this.onError?.(new Error(`Failed to load token file: ${toMessage(error)}`));
    }
  }

  private saveToFile(tokenSet: TokenSet): void {
    try {
      saveTokenToFile(this.tokenFilePath, tokenSet);
    } catch (error) {
      this.onError?.(new Error(`Failed to save token file: ${toMessage(error)}`));
    }
  }
}
