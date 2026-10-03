import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TokenSet } from '../../../src/api/daikin-types';
import { DAIKIN_OIDC_CONFIG } from '../../../src/api/daikin-types';

const storage = vi.hoisted(() => ({
  loadTokenFromFile: vi.fn(),
  saveTokenToFile: vi.fn(),
  deleteTokenFile: vi.fn(),
}));
const transport = vi.hoisted(() => ({ httpRequest: vi.fn() }));

vi.mock('../../../src/api/token-storage', () => storage);
vi.mock('../../../src/api/http-transport', () => transport);

import { DaikinOAuth } from '../../../src/api/daikin-oauth';

function response(statusCode: number, body: unknown) {
  return { statusCode, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

function lastForm(): URLSearchParams {
  const calls = transport.httpRequest.mock.calls;
  return new URLSearchParams(calls[calls.length - 1][2]);
}

describe('DaikinOAuth', () => {
  const mockConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    callbackServerExternalAddress: '192.168.1.1',
    callbackServerPort: 8582,
    tokenFilePath: '/nonexistent/test-token.json',
  };
  const now = () => Math.floor(Date.now() / 1000);

  function withStoredToken(tokenSet: TokenSet | null): void {
    storage.loadTokenFromFile.mockReturnValue(tokenSet);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    withStoredToken(null);
  });

  describe('getAccessToken', () => {
    it('should return the access token if not expired', async () => {
      withStoredToken({ access_token: 'valid-token', refresh_token: 'rt', token_type: 'Bearer', expires_at: now() + 3600 });

      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.getAccessToken()).resolves.toBe('valid-token');
      expect(transport.httpRequest).not.toHaveBeenCalled();
    });

    it('should refresh the token if expired', async () => {
      withStoredToken({ access_token: 'expired', refresh_token: 'refresh-token', token_type: 'Bearer', expires_at: now() - 100 });
      transport.httpRequest.mockResolvedValue(response(200, {
        access_token: 'new-token', refresh_token: 'new-refresh-token', token_type: 'Bearer', expires_in: 3600,
      }));
      const onTokenUpdate = vi.fn();

      const oauth = new DaikinOAuth(mockConfig, onTokenUpdate);

      await expect(oauth.getAccessToken()).resolves.toBe('new-token');
      expect(transport.httpRequest.mock.calls[0][0]).toBe(DAIKIN_OIDC_CONFIG.tokenEndpoint);
      const form = lastForm();
      expect(form.get('grant_type')).toBe('refresh_token');
      expect(form.get('refresh_token')).toBe('refresh-token');
      expect(form.get('client_id')).toBe('test-client-id');
      expect(storage.saveTokenToFile).toHaveBeenCalledWith(mockConfig.tokenFilePath, expect.objectContaining({
        access_token: 'new-token',
        expires_at: expect.any(Number),
      }));
      expect(onTokenUpdate).toHaveBeenCalledTimes(1);
    });

    it('should refresh the token if about to expire (within the buffer)', async () => {
      withStoredToken({ access_token: 'soon', refresh_token: 'rt', token_type: 'Bearer', expires_at: now() + 5 });
      transport.httpRequest.mockResolvedValue(response(200, {
        access_token: 'refreshed-token', token_type: 'Bearer', expires_in: 3600,
      }));

      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.getAccessToken()).resolves.toBe('refreshed-token');
      // Refresh token not rotated: the old one is kept
      expect(oauth.getTokenSet()?.refresh_token).toBe('rt');
    });

    it('should surface invalid_grant so the platform can drop the token file', async () => {
      withStoredToken({ access_token: 'expired', refresh_token: 'rt', token_type: 'Bearer', expires_at: now() - 100 });
      transport.httpRequest.mockResolvedValue(response(400, {
        error: 'invalid_grant',
        error_description: 'The refresh token is invalid',
      }));

      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.getAccessToken()).rejects.toThrow(
        'Token refresh failed: invalid_grant - The refresh token is invalid (HTTP 400)',
      );
      expect(storage.saveTokenToFile).not.toHaveBeenCalled();
    });

    it('should report a non-JSON 5xx body clearly', async () => {
      withStoredToken({ access_token: 'expired', refresh_token: 'rt', token_type: 'Bearer', expires_at: now() - 100 });
      transport.httpRequest.mockResolvedValue(response(502, '<html><body>Bad Gateway</body></html>'));

      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.getAccessToken()).rejects.toThrow(
        /^Token refresh failed: idp\.onecta\.daikineurope\.com returned a non-JSON response \(HTTP 502\)/,
      );
    });

    it('should throw error if token expired and no refresh token', async () => {
      withStoredToken({ access_token: 'expired', token_type: 'Bearer', expires_at: now() - 100 });

      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.getAccessToken()).rejects.toThrow(
        'Token expired and no refresh token available. Please re-authenticate.',
      );
    });

    it('should throw error if not authenticated', async () => {
      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.getAccessToken()).rejects.toThrow('Not authenticated. Please authenticate first.');
    });
  });

  describe('exchangeCode', () => {
    it('should exchange the code, store and return the token set', async () => {
      transport.httpRequest.mockResolvedValue(response(200, {
        access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3600,
      }));
      const oauth = new DaikinOAuth(mockConfig);

      const tokenSet = await oauth.exchangeCode('the-code');

      expect(tokenSet).toMatchObject({ access_token: 'at', expires_at: expect.any(Number) });
      const form = lastForm();
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('the-code');
      expect(form.get('redirect_uri')).toBe('https://192.168.1.1:8582');
      expect(oauth.isAuthenticated()).toBe(true);
      expect(storage.saveTokenToFile).toHaveBeenCalledWith(mockConfig.tokenFilePath, tokenSet);
    });

    it('should not store anything when the exchange fails', async () => {
      transport.httpRequest.mockResolvedValue(response(400, { error: 'invalid_grant' }));
      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.exchangeCode('bad')).rejects.toThrow(
        'Authorization code exchange failed: invalid_grant (HTTP 400)',
      );
      expect(oauth.isAuthenticated()).toBe(false);
      expect(storage.saveTokenToFile).not.toHaveBeenCalled();
    });
  });

  describe('exchangeCodeStatic', () => {
    it('should return a token set with expires_at', async () => {
      transport.httpRequest.mockResolvedValue(response(200, {
        access_token: 'at', token_type: 'Bearer', expires_in: 60,
      }));

      const tokenSet = await DaikinOAuth.exchangeCodeStatic('code', 'cid', 'secret', 'https://host:8582');

      expect(tokenSet.access_token).toBe('at');
      expect(tokenSet.expires_at).toBeGreaterThanOrEqual(now() + 59);
      const form = lastForm();
      expect(form.get('client_id')).toBe('cid');
      expect(form.get('redirect_uri')).toBe('https://host:8582');
      expect(storage.saveTokenToFile).not.toHaveBeenCalled();
    });

    it('should reject an HTML error page with a clear message', async () => {
      transport.httpRequest.mockResolvedValue(response(503, '<html>Service Unavailable</html>'));

      await expect(DaikinOAuth.exchangeCodeStatic('code', 'cid', 'secret', 'https://host:8582'))
        .rejects.toThrow(/non-JSON response \(HTTP 503\)/);
    });
  });

  describe('revokeToken', () => {
    it('should revoke at the server and delete the token file', async () => {
      withStoredToken({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' });
      transport.httpRequest.mockResolvedValue(response(200, ''));
      const oauth = new DaikinOAuth(mockConfig);

      await oauth.revokeToken();

      expect(transport.httpRequest.mock.calls[0][0]).toBe(DAIKIN_OIDC_CONFIG.revokeEndpoint);
      expect(lastForm().get('token')).toBe('rt');
      expect(storage.deleteTokenFile).toHaveBeenCalledWith(mockConfig.tokenFilePath);
      expect(oauth.isAuthenticated()).toBe(false);
    });

    it('should still delete the token file when revocation fails', async () => {
      withStoredToken({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' });
      transport.httpRequest.mockRejectedValue(Object.assign(new Error('boom'), { code: 'ECONNRESET' }));
      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.revokeToken()).resolves.toBeUndefined();

      expect(storage.deleteTokenFile).toHaveBeenCalledWith(mockConfig.tokenFilePath);
      expect(oauth.isAuthenticated()).toBe(false);
    });

    it('revokeTokenStatic should throw on a non-2xx status', async () => {
      transport.httpRequest.mockResolvedValue(response(401, '{"error":"invalid_client"}'));

      await expect(DaikinOAuth.revokeTokenStatic('rt', 'cid', 'secret')).rejects.toThrow(
        'Token revocation failed: HTTP 401',
      );
    });
  });

  describe('isAuthenticated', () => {
    it('should return true if token set exists', () => {
      withStoredToken({ access_token: 'token', token_type: 'Bearer' });
      expect(new DaikinOAuth(mockConfig).isAuthenticated()).toBe(true);
    });

    it('should return false if no token set', () => {
      expect(new DaikinOAuth(mockConfig).isAuthenticated()).toBe(false);
    });
  });

  describe('getTokenExpiration', () => {
    it('should return expiration date', () => {
      const expiresAt = now() + 3600;
      withStoredToken({ access_token: 'token', token_type: 'Bearer', expires_at: expiresAt });

      const expiration = new DaikinOAuth(mockConfig).getTokenExpiration();

      expect(expiration).toBeInstanceOf(Date);
      expect(expiration?.getTime()).toBe(expiresAt * 1000);
    });

    it('should return null if no expiration', () => {
      withStoredToken({ access_token: 'token', token_type: 'Bearer' });
      expect(new DaikinOAuth(mockConfig).getTokenExpiration()).toBeNull();
    });
  });
});
