import { vi } from 'vitest';
import { DaikinOAuth } from '../../../src/api/daikin-oauth';
import * as fs from 'node:fs';
import * as https from 'node:https';

vi.mock('node:fs');
vi.mock('node:https');

describe('DaikinOAuth', () => {
  const mockConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    callbackServerExternalAddress: '192.168.1.1',
    callbackServerPort: 8582,
    tokenFilePath: '/tmp/test-token.json',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  describe('getAccessToken', () => {
    it('should return the access token if not expired', async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const tokenSet = {
        access_token: 'valid-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_at: futureExpiry,
      };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(tokenSet));

      const oauth = new DaikinOAuth(mockConfig);
      const token = await oauth.getAccessToken();

      expect(token).toBe('valid-token');
    });

    it('should refresh the token if expired', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
      const tokenSet = {
        access_token: 'expired-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_at: pastExpiry,
      };

      const newTokenSet = {
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(tokenSet));

      // Mock the HTTPS request for token refresh
      const mockResponse = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify(newTokenSet));
          }
          if (event === 'end') {
            callback();
          }
        }),
      };
      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };
      (https.request as ReturnType<typeof vi.fn>).mockImplementation((options: any, callback: any) => {
        callback(mockResponse);
        return mockRequest;
      });

      const oauth = new DaikinOAuth(mockConfig);
      const token = await oauth.getAccessToken();

      expect(token).toBe('new-token');
      expect(https.request).toHaveBeenCalled();
    });

    it('should refresh the token if about to expire (within 10 seconds)', async () => {
      const soonExpiry = Math.floor(Date.now() / 1000) + 5; // 5 seconds from now
      const tokenSet = {
        access_token: 'soon-expiring-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_at: soonExpiry,
      };

      const newTokenSet = {
        access_token: 'refreshed-token',
        refresh_token: 'new-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(tokenSet));

      const mockResponse = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(JSON.stringify(newTokenSet));
          }
          if (event === 'end') {
            callback();
          }
        }),
      };
      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };
      (https.request as ReturnType<typeof vi.fn>).mockImplementation((options: any, callback: any) => {
        callback(mockResponse);
        return mockRequest;
      });

      const oauth = new DaikinOAuth(mockConfig);
      const token = await oauth.getAccessToken();

      expect(token).toBe('refreshed-token');
      expect(https.request).toHaveBeenCalled();
    });

    it('should throw error if token expired and no refresh token', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100;
      const tokenSet = {
        access_token: 'expired-token',
        token_type: 'Bearer',
        expires_at: pastExpiry,
        // No refresh_token
      };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(tokenSet));

      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.getAccessToken()).rejects.toThrow(
        'Token expired and no refresh token available. Please re-authenticate.',
      );
    });

    it('should throw error if not authenticated', async () => {
      const oauth = new DaikinOAuth(mockConfig);

      await expect(oauth.getAccessToken()).rejects.toThrow(
        'Not authenticated. Please authenticate first.',
      );
    });
  });

  describe('isAuthenticated', () => {
    it('should return true if token set exists', () => {
      const tokenSet = {
        access_token: 'token',
        token_type: 'Bearer',
      };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(tokenSet));

      const oauth = new DaikinOAuth(mockConfig);
      expect(oauth.isAuthenticated()).toBe(true);
    });

    it('should return false if no token set', () => {
      const oauth = new DaikinOAuth(mockConfig);
      expect(oauth.isAuthenticated()).toBe(false);
    });
  });

  describe('getTokenExpiration', () => {
    it('should return expiration date', () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const tokenSet = {
        access_token: 'token',
        token_type: 'Bearer',
        expires_at: expiresAt,
      };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(tokenSet));

      const oauth = new DaikinOAuth(mockConfig);
      const expiration = oauth.getTokenExpiration();

      expect(expiration).toBeInstanceOf(Date);
      expect(expiration?.getTime()).toBe(expiresAt * 1000);
    });

    it('should return null if no expiration', () => {
      const tokenSet = {
        access_token: 'token',
        token_type: 'Bearer',
      };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(tokenSet));

      const oauth = new DaikinOAuth(mockConfig);
      expect(oauth.getTokenExpiration()).toBeNull();
    });
  });
});
