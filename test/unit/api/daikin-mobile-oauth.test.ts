import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DaikinMobileOAuth } from '../../../src/api/daikin-mobile-oauth';
import * as https from 'node:https';

vi.mock('node:https');
vi.mock('../../../src/api/token-storage', () => ({
  loadTokenFromFile: vi.fn().mockReturnValue(null),
  saveTokenToFile: vi.fn(),
  deleteTokenFile: vi.fn(),
}));

const mockConfig = {
  email: 'john.doe@example.com',
  password: 'test-password',
  tokenFilePath: '/tmp/test-token.json',
};

/**
 * Helper to create a mock HTTPS response with the given status, headers, and body.
 */
function mockHttpsResponse(statusCode: number, body: string, headers: Record<string, string | string[]> = {}) {
  return (_options: unknown, callback: (res: any) => void) => {
    const res = {
      statusCode,
      headers,
      on: vi.fn((event: string, handler: (data?: string) => void) => {
        if (event === 'data') {
          handler(body);
        }
        if (event === 'end') {
          handler();
        }
        return res;
      }),
    };
    callback(res);
    return {
      on: vi.fn().mockReturnThis(),
      write: vi.fn(),
      end: vi.fn(),
      setTimeout: vi.fn(),
      destroy: vi.fn(),
    };
  };
}

describe('DaikinMobileOAuth', () => {
  let onTokenUpdate: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;
  let onLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onTokenUpdate = vi.fn();
    onError = vi.fn();
    onLog = vi.fn();
  });

  describe('gigyaLogin - pending registration (206001)', () => {
    it('should complete pending registration when 206001 with regToken is returned', async () => {
      const oauth = new DaikinMobileOAuth(mockConfig, onTokenUpdate, onError, onLog);

      // Mock the sequence of HTTPS calls:
      // 1. getOidcContext (302 redirect with context)
      // 2. initGigyaSdk (bootstrap, returns cookies)
      // 3. gigyaLogin (returns 206001 with regToken)
      // 4. completePendingRegistration (returns login_token)
      // 5. authorizeWithToken (302 redirect with code)
      // 6. exchangeCodeForTokens (returns tokens)

      const requestMock = vi.mocked(https.request);
      let callIndex = 0;

      requestMock.mockImplementation((...args: any[]) => {
        callIndex++;
        const urlArg = typeof args[0] === 'string' ? args[0] : args[0]?.href || '';
        const callback = typeof args[1] === 'function' ? args[1] : args[2];

        if (callIndex === 1) {
          return mockHttpsResponse(302, '', {
            location: 'https://id.daikin.eu/cdc/onecta/oidc/proxy.html?context=test-context-123&mode=login',
          })(urlArg, callback);
        }

        if (callIndex === 2) {
          return mockHttpsResponse(200, '{}', {
            'set-cookie': ['gig_canary=abc123; Path=/'],
          })(urlArg, callback);
        }

        // gigyaLogin: returns 206001 with regToken
        if (callIndex === 3) {
          return mockHttpsResponse(200, JSON.stringify({
            errorCode: 206001,
            errorMessage: 'Account Pending Registration',
            regToken: 'reg-token-abc',
            data: {
              profile: {
                countryResidence: 'FR',
                communicationLanguage: 'fr',
              },
            },
            profile: {
              firstName: 'Jean',
              lastName: 'Dupont',
            },
          }))(urlArg, callback);
        }

        // completePendingRegistration (accounts.register) - returns login_token
        if (callIndex === 4) {
          return mockHttpsResponse(200, JSON.stringify({
            errorCode: 0,
            sessionInfo: { login_token: 'login-token-xyz' },
          }))(urlArg, callback);
        }

        // authorizeWithToken - 302 redirect with code
        if (callIndex === 5) {
          return mockHttpsResponse(302, '', {
            location: 'daikinunified://login?code=auth-code-456',
          })(urlArg, callback);
        }

        // exchangeCodeForTokens - returns tokens
        if (callIndex === 6) {
          return mockHttpsResponse(200, JSON.stringify({
            access_token: 'access-token-final',
            refresh_token: 'refresh-token-final',
            token_type: 'Bearer',
            expires_in: 3600,
          }))(urlArg, callback);
        }

        return mockHttpsResponse(500, 'Unexpected call')(urlArg, callback);
      });

      const tokenSet = await oauth.authenticate();

      expect(tokenSet.access_token).toBe('access-token-final');
      expect(onLog).toHaveBeenCalledWith(
        expect.stringContaining('Account has pending registration (206001)'),
      );
      expect(onLog).toHaveBeenCalledWith(
        expect.stringContaining('Pending registration completed successfully'),
      );
      // Should use existing profile data, not derive from email
      expect(onLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Using derived name'),
      );
    });

    it('should derive name from email when profile names are missing', async () => {
      const oauth = new DaikinMobileOAuth(mockConfig, onTokenUpdate, onError, onLog);

      const requestMock = vi.mocked(https.request);
      let callIndex = 0;

      requestMock.mockImplementation((...args: any[]) => {
        callIndex++;
        const urlArg = typeof args[0] === 'string' ? args[0] : args[0]?.href || '';
        const callback = typeof args[1] === 'function' ? args[1] : args[2];

        if (callIndex === 1) {
          return mockHttpsResponse(302, '', {
            location: 'https://id.daikin.eu/?context=ctx&mode=login',
          })(urlArg, callback);
        }
        if (callIndex === 2) {
          return mockHttpsResponse(200, '{}', {
            'set-cookie': ['gig_canary=abc; Path=/'],
          })(urlArg, callback);
        }
        // gigyaLogin: 206001 with regToken but NO profile names
        if (callIndex === 3) {
          return mockHttpsResponse(200, JSON.stringify({
            errorCode: 206001,
            errorMessage: 'Account Pending Registration',
            regToken: 'reg-token-abc',
            data: { profile: {} },
          }))(urlArg, callback);
        }
        // completePendingRegistration
        if (callIndex === 4) {
          return mockHttpsResponse(200, JSON.stringify({
            errorCode: 0,
            sessionInfo: { login_token: 'login-token-xyz' },
          }))(urlArg, callback);
        }
        if (callIndex === 5) {
          return mockHttpsResponse(302, '', {
            location: 'daikinunified://login?code=auth-code',
          })(urlArg, callback);
        }
        if (callIndex === 6) {
          return mockHttpsResponse(200, JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt',
            token_type: 'Bearer',
            expires_in: 3600,
          }))(urlArg, callback);
        }
        return mockHttpsResponse(500, 'Unexpected')(urlArg, callback);
      });

      await oauth.authenticate();

      // Should derive "John" and "Doe" from john.doe@example.com
      expect(onLog).toHaveBeenCalledWith(
        expect.stringContaining('Using derived name for registration: John Doe'),
      );
    });

    it('should use sessionInfo.login_token from 206001 response if present', async () => {
      const oauth = new DaikinMobileOAuth(mockConfig, onTokenUpdate, onError, onLog);

      const requestMock = vi.mocked(https.request);
      let callIndex = 0;

      requestMock.mockImplementation((...args: any[]) => {
        callIndex++;
        const urlArg = typeof args[0] === 'string' ? args[0] : args[0]?.href || '';
        const callback = typeof args[1] === 'function' ? args[1] : args[2];

        if (callIndex === 1) {
          return mockHttpsResponse(302, '', {
            location: 'https://id.daikin.eu/?context=ctx&mode=login',
          })(urlArg, callback);
        }
        if (callIndex === 2) {
          return mockHttpsResponse(200, '{}', {
            'set-cookie': ['gig_canary=abc; Path=/'],
          })(urlArg, callback);
        }
        // gigyaLogin: 206001 but WITH sessionInfo.login_token already present
        if (callIndex === 3) {
          return mockHttpsResponse(200, JSON.stringify({
            errorCode: 206001,
            errorMessage: 'Account Pending Registration',
            sessionInfo: { login_token: 'already-has-token' },
            regToken: 'reg-token-unused',
          }))(urlArg, callback);
        }
        // No registration needed — goes straight to authorize
        if (callIndex === 4) {
          return mockHttpsResponse(302, '', {
            location: 'daikinunified://login?code=auth-code',
          })(urlArg, callback);
        }
        if (callIndex === 5) {
          return mockHttpsResponse(200, JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt',
            token_type: 'Bearer',
            expires_in: 3600,
          }))(urlArg, callback);
        }
        return mockHttpsResponse(500, 'Unexpected')(urlArg, callback);
      });

      const tokenSet = await oauth.authenticate();

      expect(tokenSet.access_token).toBe('at');
      // Should NOT have called completePendingRegistration
      expect(onLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Completing pending registration'),
      );
      // Total calls: oidc + bootstrap + login + authorize + token exchange = 5 (not 6)
      expect(callIndex).toBe(5);
    });

    it('should throw if registration completion fails', async () => {
      const oauth = new DaikinMobileOAuth(mockConfig, onTokenUpdate, onError, onLog);

      const requestMock = vi.mocked(https.request);
      let callIndex = 0;

      requestMock.mockImplementation((...args: any[]) => {
        callIndex++;
        const urlArg = typeof args[0] === 'string' ? args[0] : args[0]?.href || '';
        const callback = typeof args[1] === 'function' ? args[1] : args[2];

        if (callIndex === 1) {
          return mockHttpsResponse(302, '', {
            location: 'https://id.daikin.eu/?context=ctx&mode=login',
          })(urlArg, callback);
        }
        if (callIndex === 2) {
          return mockHttpsResponse(200, '{}', {
            'set-cookie': ['gig_canary=abc; Path=/'],
          })(urlArg, callback);
        }
        // gigyaLogin: 206001
        if (callIndex === 3) {
          return mockHttpsResponse(200, JSON.stringify({
            errorCode: 206001,
            regToken: 'reg-token-abc',
            data: { profile: {} },
          }))(urlArg, callback);
        }
        // completePendingRegistration: fails
        if (callIndex === 4) {
          return mockHttpsResponse(200, JSON.stringify({
            errorCode: 400006,
            errorMessage: 'Unallowed value',
          }))(urlArg, callback);
        }
        return mockHttpsResponse(500, 'Unexpected')(urlArg, callback);
      });

      await expect(oauth.authenticate()).rejects.toThrow(
        'Registration completion failed (400006): Unallowed value',
      );
    });

    it('should throw original error for non-206001 error codes', async () => {
      const oauth = new DaikinMobileOAuth(mockConfig, onTokenUpdate, onError, onLog);

      const requestMock = vi.mocked(https.request);
      let callIndex = 0;

      requestMock.mockImplementation((...args: any[]) => {
        callIndex++;
        const urlArg = typeof args[0] === 'string' ? args[0] : args[0]?.href || '';
        const callback = typeof args[1] === 'function' ? args[1] : args[2];

        if (callIndex === 1) {
          return mockHttpsResponse(302, '', {
            location: 'https://id.daikin.eu/?context=ctx&mode=login',
          })(urlArg, callback);
        }
        if (callIndex === 2) {
          return mockHttpsResponse(200, '{}', {
            'set-cookie': ['gig_canary=abc; Path=/'],
          })(urlArg, callback);
        }
        // gigyaLogin: different error (invalid credentials)
        if (callIndex === 3) {
          return mockHttpsResponse(200, JSON.stringify({
            errorCode: 403042,
            errorMessage: 'Invalid LoginID',
          }))(urlArg, callback);
        }
        return mockHttpsResponse(500, 'Unexpected')(urlArg, callback);
      });

      await expect(oauth.authenticate()).rejects.toThrow(
        'Login failed (403042): Invalid LoginID',
      );
    });
  });
});
