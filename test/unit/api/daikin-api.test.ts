import {DaikinApi, RateLimitedError} from '../../../src/api/daikin-api';
import {OAuthProvider, TokenSet} from '../../../src/api/daikin-types';
import {MAX_RETRY_ATTEMPTS} from '../../../src/constants';
import * as https from 'node:https';

jest.mock('node:https');

describe('DaikinApi', () => {
    let mockOAuth: jest.Mocked<OAuthProvider>;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        mockOAuth = {
            getAccessToken: jest.fn().mockResolvedValue('valid-token'),
            isAuthenticated: jest.fn().mockReturnValue(true),
            refreshToken: jest.fn().mockResolvedValue({
                access_token: 'new-token',
                refresh_token: 'new-refresh-token',
                token_type: 'Bearer',
                expires_in: 3600,
            } as TokenSet),
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // Helper to run async operations with fake timers
    async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
        const result = promise;
        // Run timers until all pending timers are exhausted
        await jest.runAllTimersAsync();
        return result;
    }

    function mockHttpsRequest(statusCode: number, body: string, headers: Record<string, string> = {}) {
        const mockResponse = {
            statusCode,
            headers,
            on: jest.fn((event, callback) => {
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
            on: jest.fn().mockReturnThis(),
            write: jest.fn(),
            end: jest.fn(),
        };
        (https.request as jest.Mock).mockImplementation((options, callback) => {
            callback(mockResponse);
            return mockRequest;
        });
        return {mockRequest, mockResponse};
    }

    describe('getDevices', () => {
        it('should return devices on successful request', async () => {
            const devices = [{id: 'device-1', managementPoints: []}];
            mockHttpsRequest(200, JSON.stringify(devices));

            const api = new DaikinApi(mockOAuth);
            const result = await api.getDevices();

            expect(result).toEqual(devices);
            expect(mockOAuth.getAccessToken).toHaveBeenCalled();
        });

        it('should refresh token and retry on 401 Unauthorized with exponential backoff', async () => {
            const devices = [{id: 'device-1', managementPoints: []}];
            let callCount = 0;

            const mockRequest = {
                on: jest.fn().mockReturnThis(),
                write: jest.fn(),
                end: jest.fn(),
            };

            (https.request as jest.Mock).mockImplementation((options, callback) => {
                callCount++;
                const statusCode = callCount === 1 ? 401 : 200;
                const body = callCount === 1 ? 'Unauthorized' : JSON.stringify(devices);

                const mockResponse = {
                    statusCode,
                    headers: {},
                    on: jest.fn((event, cb) => {
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
            jest.useRealTimers(); // Use real timers for this test
            // Always return 401
            mockHttpsRequest(401, 'Unauthorized');

            const api = new DaikinApi(mockOAuth);

            // Temporarily override sleep to be instant for testing
            const originalSleep = (api as unknown as { sleep: (ms: number) => Promise<void> }).sleep;
            (api as unknown as { sleep: (ms: number) => Promise<void> }).sleep = () => Promise.resolve();

            await expect(api.getDevices()).rejects.toThrow(
                'Unauthorized (401): Token expired or invalid',
            );
            // Should retry MAX_RETRY_ATTEMPTS times
            expect(mockOAuth.refreshToken).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
            // Initial request + MAX_RETRY_ATTEMPTS retries
            expect(https.request).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

            // Restore original sleep
            (api as unknown as { sleep: (ms: number) => Promise<void> }).sleep = originalSleep;
        });

        it('should not retry more than MAX_RETRY_ATTEMPTS times on 401', async () => {
            jest.useRealTimers(); // Use real timers for this test
            // Always return 401
            mockHttpsRequest(401, 'Unauthorized');

            const api = new DaikinApi(mockOAuth);

            // Temporarily override sleep to be instant for testing
            (api as unknown as { sleep: (ms: number) => Promise<void> }).sleep = () => Promise.resolve();

            await expect(api.getDevices()).rejects.toThrow('Unauthorized');
            // Should only refresh MAX_RETRY_ATTEMPTS times
            expect(mockOAuth.refreshToken).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
        });
    });

    describe('rate limiting', () => {
        it('should throw RateLimitedError on 429', async () => {
            mockHttpsRequest(429, 'Too Many Requests', {'retry-after': '60'});

            const api = new DaikinApi(mockOAuth);

            await expect(api.getDevices()).rejects.toThrow(RateLimitedError);
        });

        it('should block subsequent requests after rate limit', async () => {
            mockHttpsRequest(429, 'Too Many Requests', {'retry-after': '60'});

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
});
