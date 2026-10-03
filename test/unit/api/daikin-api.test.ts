import { vi } from 'vitest';
import { DaikinApi, RateLimitedError, ApiTimeoutError } from '../../../src/api/daikin-api';
import type { OAuthProvider, TokenSet } from '../../../src/api/daikin-types';
import { MAX_RETRY_ATTEMPTS } from '../../../src/constants';
import * as https from 'node:https';

vi.mock('node:https');

describe('DaikinApi', () => {
  let mockOAuth: ReturnType<typeof vi.mocked<OAuthProvider>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockOAuth = {
      getAccessToken: vi.fn().mockResolvedValue('valid-token'),
      isAuthenticated: vi.fn().mockReturnValue(true),
      refreshToken: vi.fn().mockResolvedValue({
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      } as TokenSet),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to run async operations with fake timers
  async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
    const result = promise;
    // Run timers until all pending timers are exhausted
    await vi.runAllTimersAsync();
    return result;
  }

  function mockHttpsRequest(statusCode: number, body: string, headers: Record<string, string> = {}) {
    const mockResponse: any = {
      statusCode,
      headers,
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(body);
        }
        if (event === 'end') {
          callback();
        }
        return mockResponse;
      }),
    };
    const mockRequest = {
      on: vi.fn().mockReturnThis(),
      write: vi.fn(),
      end: vi.fn(),
      setTimeout: vi.fn(),
    };
    (https.request as ReturnType<typeof vi.fn>).mockImplementation((options: any, callback: any) => {
      callback(mockResponse);
      return mockRequest;
    });
    return { mockRequest, mockResponse };
  }

  describe('getDevices', () => {
    it('should return devices on successful request', async () => {
      const devices = [{ id: 'device-1', managementPoints: [] }];
      mockHttpsRequest(200, JSON.stringify(devices));

      const api = new DaikinApi(mockOAuth);
      const result = await api.getDevices();

      expect(result).toEqual(devices);
      expect(mockOAuth.getAccessToken).toHaveBeenCalled();
    });

    it('should refresh token and retry on 401 Unauthorized with exponential backoff', async () => {
      const devices = [{ id: 'device-1', managementPoints: [] }];
      let callCount = 0;

      const mockRequest = {
        on: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
        setTimeout: vi.fn(),
      };

      (https.request as ReturnType<typeof vi.fn>).mockImplementation((options: any, callback: any) => {
        callCount++;
        const statusCode = callCount === 1 ? 401 : 200;
        const body = callCount === 1 ? 'Unauthorized' : JSON.stringify(devices);

        const mockResponse: any = {
          statusCode,
          headers: {},
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(body);
            }
            if (event === 'end') {
              cb();
            }
            return mockResponse;
          }),
        };
        callback(mockResponse);
        return mockRequest;
      });

      // After refresh, return a new token
      mockOAuth.getAccessToken
        .mockResolvedValueOnce('expired-token')
        .mockResolvedValueOnce('new-token');

      const api = new DaikinApi(mockOAuth);
      const result = await runWithTimers(api.getDevices());

      expect(result).toEqual(devices);
      expect(mockOAuth.refreshToken).toHaveBeenCalledTimes(1);
      expect(https.request).toHaveBeenCalledTimes(2);
    });

    it('should throw error if refresh fails on 401', async () => {
      mockHttpsRequest(401, 'Unauthorized');
      mockOAuth.refreshToken.mockRejectedValue(new Error('Refresh failed'));

      const api = new DaikinApi(mockOAuth);

      await expect(api.getDevices()).rejects.toThrow(
        'Unauthorized (401): Token refresh failed. Please re-authenticate.',
      );
      expect(mockOAuth.refreshToken).toHaveBeenCalledTimes(1);
    });

    it('should throw error if retry after refresh still returns 401', async () => {
      // Always return 401
      mockHttpsRequest(401, 'Unauthorized');

      const api = new DaikinApi(mockOAuth);

      const promise = api.getDevices().catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await promise;
      expect(error.message).toBe('Unauthorized (401): Token expired or invalid');
      // Should retry MAX_RETRY_ATTEMPTS times
      expect(mockOAuth.refreshToken).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
      // Initial request + MAX_RETRY_ATTEMPTS retries
      expect(https.request).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
    });

    it('should not retry more than MAX_RETRY_ATTEMPTS times on 401', async () => {
      // Always return 401
      mockHttpsRequest(401, 'Unauthorized');

      const api = new DaikinApi(mockOAuth);

      const promise = api.getDevices().catch((e) => e);
      await vi.runAllTimersAsync();
      expect((await promise).message).toContain('Unauthorized');
      // Should only refresh MAX_RETRY_ATTEMPTS times
      expect(mockOAuth.refreshToken).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
    });

    it('should deduplicate concurrent token refresh requests', async () => {

      // Create a slow refresh that we can control
      let resolveRefresh!: () => void;
      const refreshPromise = new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });

      let callCount = 0;
      mockOAuth.refreshToken.mockImplementation(async () => {
        callCount++;
        await refreshPromise;
        return {
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        } as TokenSet;
      });

      const devices = [{ id: 'device-1', managementPoints: [] }];
      let httpCallCount = 0;
      const mockRequest = {
        on: vi.fn().mockReturnThis(),
        write: vi.fn(),
        end: vi.fn(),
        setTimeout: vi.fn(),
      };

      (https.request as ReturnType<typeof vi.fn>).mockImplementation((options: any, callback: any) => {
        httpCallCount++;
        // First two return 401, then 200
        const statusCode = httpCallCount <= 2 ? 401 : 200;
        const body = statusCode === 200 ? JSON.stringify(devices) : 'Unauthorized';
        const mockResponse: any = {
          statusCode,
          headers: {},
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              cb(body);
            }
            if (event === 'end') {
              cb();
            }
            return mockResponse;
          }),
        };
        callback(mockResponse);
        return mockRequest;
      });

      const api = new DaikinApi(mockOAuth);

      mockOAuth.getAccessToken
        .mockResolvedValueOnce('expired-token')
        .mockResolvedValueOnce('expired-token')
        .mockResolvedValue('new-token');

      // Fire two concurrent requests that will both get 401
      const p1 = api.getDevices();
      const p2 = api.getDevices();

      // Let the refresh complete
      resolveRefresh();
      await vi.runAllTimersAsync();

      await Promise.all([p1, p2]);

      // Should only have refreshed once despite two concurrent 401s
      expect(callCount).toBe(1);
    });
  });

  describe('rate limiting', () => {
    it('should throw RateLimitedError on 429', async () => {
      mockHttpsRequest(429, 'Too Many Requests', { 'retry-after': '60' });

      const api = new DaikinApi(mockOAuth);

      await expect(api.getDevices()).rejects.toThrow(RateLimitedError);
    });

    it('should block subsequent requests after rate limit', async () => {
      mockHttpsRequest(429, 'Too Many Requests', { 'retry-after': '60' });

      const api = new DaikinApi(mockOAuth);

      await expect(api.getDevices()).rejects.toThrow(RateLimitedError);
      expect(api.isRateLimited()).toBe(true);

      // Reset mock to return 200, but should still be blocked
      mockHttpsRequest(200, '[]');

      await expect(api.getDevices()).rejects.toThrow(
        'API request blocked due to rate limit',
      );
    });
  });

  /** Respond with `statusCodes[i]` to the i-th request (last one repeats) */
  function mockHttpsSequence(statusCodes: number[], okBody = '[]') {
    let callCount = 0;
    const mockRequest = {
      on: vi.fn().mockReturnThis(),
      write: vi.fn(),
      end: vi.fn(),
      setTimeout: vi.fn(),
    };
    (https.request as ReturnType<typeof vi.fn>).mockImplementation((options: any, callback: any) => {
      const statusCode = statusCodes[Math.min(callCount, statusCodes.length - 1)];
      callCount++;
      const body = statusCode < 300 ? okBody : 'Gateway error';
      const mockResponse: any = {
        statusCode,
        headers: {},
        on: vi.fn((event, cb) => {
          if (event === 'data') {
            cb(body);
          }
          if (event === 'end') {
            cb();
          }
          return mockResponse;
        }),
      };
      callback(mockResponse);
      return mockRequest;
    });
    return mockRequest;
  }

  describe('gateway errors', () => {
    it.each([502, 503, 504])('does not retry a polling GET on %i (the next poll is the retry)', async (status) => {
      mockHttpsSequence([status, 200]);

      const api = new DaikinApi(mockOAuth);
      const promise = api.getDevices().catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await promise;

      expect(error).toBeInstanceOf(ApiTimeoutError);
      expect(error.statusCode).toBe(status);
      expect(error.attemptsMade).toBe(1);
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    it('retries a GET on gateway errors when explicitly requested (discovery)', async () => {
      const devices = [{ id: 'device-1', managementPoints: [] }];
      mockHttpsSequence([504, 200], JSON.stringify(devices));

      const api = new DaikinApi(mockOAuth);
      const result = await runWithTimers(api.getDevices({ retryGatewayErrors: true }));

      expect(result).toEqual(devices);
      expect(https.request).toHaveBeenCalledTimes(2);
    });

    it.each([502, 503, 504])('retries a PATCH on %i and succeeds', async (status) => {
      mockHttpsSequence([status, 204]);

      const api = new DaikinApi(mockOAuth);
      await runWithTimers(api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on'));

      expect(https.request).toHaveBeenCalledTimes(2);
    });

    it('retries a holiday-mode POST on gateway errors', async () => {
      mockHttpsSequence([503, 204]);

      const api = new DaikinApi(mockOAuth);
      await runWithTimers(api.setHolidayMode('device-1', 'climateControl', { enabled: true }));

      expect(https.request).toHaveBeenCalledTimes(2);
    });

    it.each([
      [502, 'Bad Gateway'],
      [503, 'Service Unavailable'],
      [504, 'Gateway Timeout'],
    ])('throws ApiTimeoutError after exhausting write retries on %i', async (status, name) => {
      mockHttpsSequence([status]);

      const api = new DaikinApi(mockOAuth);
      const promise = api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on').catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await promise;

      expect(error).toBeInstanceOf(ApiTimeoutError);
      expect(error.statusCode).toBe(status);
      expect(error.attemptsMade).toBe(MAX_RETRY_ATTEMPTS + 1);
      expect(error.message).toContain(name);
      expect(error.message).toContain(String(status));
      expect(https.request).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);
    });
  });

  describe('write coalescing', () => {
    it('replaces the value of a queued write to the same target and resolves both callers', async () => {
      const mockRequest = mockHttpsSequence([204]);

      const api = new DaikinApi(mockOAuth);
      const p1 = api.updateDevice('device-1', 'climateControl', 'temperatureControl', 20, '/a');
      await vi.advanceTimersByTimeAsync(0); // p1 has been sent; the queue is in its inter-request gap
      // These two queue behind p1 for the same target: the second replaces the first's value
      const p2 = api.updateDevice('device-1', 'climateControl', 'temperatureControl', 21, '/a');
      const p3 = api.updateDevice('device-1', 'climateControl', 'temperatureControl', 22, '/a');

      await vi.runAllTimersAsync();
      await Promise.all([p1, p2, p3]);

      expect(https.request).toHaveBeenCalledTimes(2);
      const bodies = mockRequest.write.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
      expect(bodies).toEqual([{ value: 20, path: '/a' }, { value: 22, path: '/a' }]);
    });

    it('does not coalesce writes to different targets', async () => {
      const mockRequest = mockHttpsSequence([204]);

      const api = new DaikinApi(mockOAuth);
      const p1 = api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on');
      const p2 = api.updateDevice('device-1', 'climateControl', 'temperatureControl', 21, '/a');
      const p3 = api.updateDevice('device-1', 'climateControl', 'temperatureControl', 22, '/b');

      await vi.runAllTimersAsync();
      await Promise.all([p1, p2, p3]);

      expect(https.request).toHaveBeenCalledTimes(3);
      expect(mockRequest.write).toHaveBeenCalledTimes(3);
    });

    it('rejects all coalesced callers with the same error', async () => {
      mockHttpsSequence([400]);

      const api = new DaikinApi(mockOAuth);
      const p1 = api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on').catch((e) => e);
      await vi.advanceTimersByTimeAsync(0);
      const p2 = api.updateDevice('device-1', 'climateControl', 'onOffMode', 'off').catch((e) => e);
      const p3 = api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on').catch((e) => e);
      await vi.runAllTimersAsync();

      const [e1, e2, e3] = await Promise.all([p1, p2, p3]);
      expect(e1).not.toBe(e2);
      expect(e2).toBe(e3);
      expect(https.request).toHaveBeenCalledTimes(2);
    });

    it('keeps the inter-request gap between writes for the same device', async () => {
      mockHttpsSequence([204]);

      const api = new DaikinApi(mockOAuth);
      void api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on');
      void api.updateDevice('device-1', 'climateControl', 'operationMode', 'cooling');

      await vi.advanceTimersByTimeAsync(0);
      expect(https.request).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(399);
      expect(https.request).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(https.request).toHaveBeenCalledTimes(2);
      await vi.runAllTimersAsync();
    });
  });

  describe('rate limit reporting', () => {
    it('reports rate-limit headers when present and stays silent otherwise', async () => {
      const onStatus = vi.fn();
      mockHttpsRequest(200, '[]', { 'x-ratelimit-remaining-day': '0', 'x-ratelimit-limit-day': '200' });
      const api = new DaikinApi(mockOAuth, onStatus);
      await api.getDevices();
      expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ remainingDay: 0, limitDay: 200 }));

      onStatus.mockClear();
      mockHttpsRequest(200, '[]');
      await api.getDevices();
      expect(onStatus).not.toHaveBeenCalled();
    });
  });

  describe('bad request handling', () => {
    it('translates READ_ONLY_CHARACTERISTIC into an actionable message', async () => {
      mockHttpsRequest(400, JSON.stringify({
        code: 'READ_ONLY_CHARACTERISTIC',
        message: 'Characteristic is read-only and therefore can not be set',
      }));

      const api = new DaikinApi(mockOAuth);
      const promise = api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on').catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await promise;

      expect(error.message).toContain('temporarily read-only');
      expect(error.message).toContain('powered off, updating its firmware');
    });

    it('keeps the raw body for other 400 errors', async () => {
      mockHttpsRequest(400, JSON.stringify({ code: 'INVALID_VALUE' }));

      const api = new DaikinApi(mockOAuth);
      const promise = api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on').catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await promise;

      expect(error.message).toContain('Bad Request (400)');
      expect(error.message).toContain('INVALID_VALUE');
    });

    it('keeps the raw body when the 400 body is not JSON', async () => {
      mockHttpsRequest(400, '<html>WAF error page</html>');

      const api = new DaikinApi(mockOAuth);
      const promise = api.updateDevice('device-1', 'climateControl', 'onOffMode', 'on').catch((e) => e);
      await vi.runAllTimersAsync();
      const error = await promise;

      expect(error.message).toContain('Bad Request (400)');
    });
  });

  describe('URL path encoding', () => {
    it('encodes cloud-supplied identifiers so they cannot change the endpoint', async () => {
      mockHttpsRequest(204, '');

      const api = new DaikinApi(mockOAuth);
      const p1 = api.updateDevice('dev/../x', 'mp?y=1', 'name#z', 'v');
      const p2 = api.setHolidayMode('dev/1', 'mp/2', { enabled: true });
      const p3 = api.triggerFirmwareUpdate('dev/1', 'gateway', 'fw/../../evil?a');
      await vi.runAllTimersAsync();
      await Promise.all([p1, p2, p3]);

      const paths = vi.mocked(https.request).mock.calls.map(c => (c[0] as any).path);
      expect(paths).toEqual([
        '/v1/gateway-devices/dev%2F..%2Fx/management-points/mp%3Fy%3D1/characteristics/name%23z',
        '/v1/gateway-devices/dev%2F1/management-points/mp%2F2/holiday-mode',
        '/v1/gateway-devices/dev%2F1/management-points/gateway/firmware/fw%2F..%2F..%2Fevil%3Fa',
      ]);
    });
  });

  describe('triggerFirmwareUpdate', () => {
    it('issues a body-less PUT to the dedicated firmware sub-resource', async () => {
      mockHttpsRequest(204, '');

      const api = new DaikinApi(mockOAuth);
      const promise = api.triggerFirmwareUpdate('device-1', 'gateway', 'fw-uuid-123');
      await vi.runAllTimersAsync();
      await promise;

      const options = vi.mocked(https.request).mock.calls[0][0] as any;
      expect(options.method).toBe('PUT');
      expect(options.path).toBe('/v1/gateway-devices/device-1/management-points/gateway/firmware/fw-uuid-123');
    });
  });
});
