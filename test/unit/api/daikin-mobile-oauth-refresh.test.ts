import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { TokenSet } from '../../../src/api/daikin-types';
import { DAIKIN_MOBILE_CONFIG } from '../../../src/api/daikin-types';
import { TOKEN_EXPIRY_BUFFER_SECONDS } from '../../../src/constants';

const storage = vi.hoisted(() => ({
  loadTokenFromFile: vi.fn(),
  saveTokenToFile: vi.fn(),
  deleteTokenFile: vi.fn(),
}));
const transport = vi.hoisted(() => ({ httpRequest: vi.fn() }));

vi.mock('../../../src/api/token-storage', () => storage);
vi.mock('../../../src/api/http-transport', () => transport);

import { DaikinMobileOAuth } from '../../../src/api/daikin-mobile-oauth';

const mockConfig = {
  email: 'john.doe@example.com',
  password: 'test-password',
  tokenFilePath: '/nonexistent/test-mobile-token.json',
};

const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const nowSeconds = Math.floor(NOW_MS / 1000);

function storedToken(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    token_type: 'Bearer',
    expires_at: nowSeconds - 60,
    ...overrides,
  };
}

function jsonResponse(statusCode: number, body: unknown) {
  return { statusCode, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

const freshTokens = {
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  token_type: 'Bearer',
  expires_in: 3600,
};

describe('DaikinMobileOAuth token refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    vi.clearAllMocks();
    storage.loadTokenFromFile.mockReturnValue(storedToken());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes an expired token with Basic auth and grant_type=refresh_token', async () => {
    transport.httpRequest.mockResolvedValue(jsonResponse(200, freshTokens));
    const onTokenUpdate = vi.fn();
    const oauth = new DaikinMobileOAuth(mockConfig, onTokenUpdate);

    await expect(oauth.getAccessToken()).resolves.toBe('new-access');

    expect(transport.httpRequest).toHaveBeenCalledTimes(1);
    const [url, options, body] = transport.httpRequest.mock.calls[0];
    expect(url).toBe(DAIKIN_MOBILE_CONFIG.idpTokenEndpoint);
    expect(options.method).toBe('POST');
    const expectedAuth = 'Basic ' + Buffer.from(
      `${DAIKIN_MOBILE_CONFIG.clientId}:${DAIKIN_MOBILE_CONFIG.clientSecret}`,
    ).toString('base64');
    expect(options.headers.Authorization).toBe(expectedAuth);
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('old-refresh');

    const expected = { ...freshTokens, expires_at: nowSeconds + 3600 };
    expect(oauth.getTokenSet()).toEqual(expected);
    expect(storage.saveTokenToFile).toHaveBeenCalledWith(mockConfig.tokenFilePath, expected);
    expect(onTokenUpdate).toHaveBeenCalledWith(expected);
  });

  it('does not refresh a token outside the expiry buffer', async () => {
    storage.loadTokenFromFile.mockReturnValue(storedToken({ expires_at: nowSeconds + TOKEN_EXPIRY_BUFFER_SECONDS + 1 }));
    const oauth = new DaikinMobileOAuth(mockConfig);

    await expect(oauth.getAccessToken()).resolves.toBe('old-access');
    expect(transport.httpRequest).not.toHaveBeenCalled();
  });

  it('refreshes a token that expires within the buffer', async () => {
    storage.loadTokenFromFile.mockReturnValue(storedToken({ expires_at: nowSeconds + TOKEN_EXPIRY_BUFFER_SECONDS - 1 }));
    transport.httpRequest.mockResolvedValue(jsonResponse(200, freshTokens));
    const oauth = new DaikinMobileOAuth(mockConfig);

    await expect(oauth.getAccessToken()).resolves.toBe('new-access');
    expect(transport.httpRequest).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight refresh between concurrent callers', async () => {
    let resolveRequest: (value: unknown) => void = () => undefined;
    transport.httpRequest.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const oauth = new DaikinMobileOAuth(mockConfig);

    const calls = [oauth.getAccessToken(), oauth.getAccessToken(), oauth.refreshToken()] as const;
    await vi.advanceTimersByTimeAsync(0);
    resolveRequest(jsonResponse(200, freshTokens));

    const [a, b, c] = await Promise.all(calls);
    expect(a).toBe('new-access');
    expect(b).toBe('new-access');
    expect(c.access_token).toBe('new-access');
    expect(transport.httpRequest).toHaveBeenCalledTimes(1);
    expect(storage.saveTokenToFile).toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight promise after a failed refresh so the next call retries', async () => {
    transport.httpRequest
      .mockResolvedValueOnce(jsonResponse(503, '<html>Service Unavailable</html>'))
      .mockResolvedValueOnce(jsonResponse(200, freshTokens));
    const oauth = new DaikinMobileOAuth(mockConfig);

    await expect(oauth.getAccessToken()).rejects.toThrow('Token refresh failed');
    await expect(oauth.getAccessToken()).resolves.toBe('new-access');
    expect(transport.httpRequest).toHaveBeenCalledTimes(2);
  });

  it('throws the OAuth error from an error body (keeping the error code)', async () => {
    transport.httpRequest.mockResolvedValue(jsonResponse(400, {
      error: 'invalid_grant',
      error_description: 'Refresh token is expired',
    }));
    const oauth = new DaikinMobileOAuth(mockConfig);

    await expect(oauth.getAccessToken()).rejects.toThrow(
      'Token refresh failed: invalid_grant - Refresh token is expired (HTTP 400)',
    );
    expect(storage.saveTokenToFile).not.toHaveBeenCalled();
    expect(oauth.getTokenSet()?.access_token).toBe('old-access');
  });

  it('reports a WAF HTML page clearly instead of a JSON SyntaxError', async () => {
    transport.httpRequest.mockResolvedValue(jsonResponse(403, '<!DOCTYPE html><html>Request blocked</html>'));
    const oauth = new DaikinMobileOAuth(mockConfig);

    const error = await oauth.getAccessToken().catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect((error as Error).message).toMatch(
      /^Token refresh failed: idp\.onecta\.daikineurope\.com returned a non-JSON response \(HTTP 403\)/,
    );
  });

  it('rejects a 200 response that is not a valid token set', async () => {
    transport.httpRequest.mockResolvedValue(jsonResponse(200, { token_type: 'Bearer' }));
    const oauth = new DaikinMobileOAuth(mockConfig);

    await expect(oauth.getAccessToken()).rejects.toThrow(/invalid token response.*access_token/);
  });

  it('retries transient network errors during refresh', async () => {
    const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    transport.httpRequest
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce(jsonResponse(200, freshTokens));
    const oauth = new DaikinMobileOAuth(mockConfig);

    const promise = oauth.getAccessToken();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('new-access');
    expect(transport.httpRequest).toHaveBeenCalledTimes(2);
  });

  it('throws when the token is expired and there is no refresh token', async () => {
    storage.loadTokenFromFile.mockReturnValue(storedToken({ refresh_token: undefined }));
    const oauth = new DaikinMobileOAuth(mockConfig);

    await expect(oauth.getAccessToken()).rejects.toThrow(
      'Token expired and no refresh token available. Please re-authenticate.',
    );
    await expect(oauth.refreshToken()).rejects.toThrow('No refresh token available');
    expect(transport.httpRequest).not.toHaveBeenCalled();
  });

  it('throws when not authenticated', async () => {
    storage.loadTokenFromFile.mockReturnValue(null);
    const oauth = new DaikinMobileOAuth(mockConfig);

    expect(oauth.isAuthenticated()).toBe(false);
    await expect(oauth.getAccessToken()).rejects.toThrow('Not authenticated. Please authenticate first.');
  });

  it('clearTokens deletes the token file', () => {
    const oauth = new DaikinMobileOAuth(mockConfig);
    oauth.clearTokens();
    expect(storage.deleteTokenFile).toHaveBeenCalledWith(mockConfig.tokenFilePath);
    expect(oauth.isAuthenticated()).toBe(false);
  });
});
