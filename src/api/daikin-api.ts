/**
 * Daikin Cloud API Client
 *
 * Handles REST API calls to the Daikin Cloud.
 */

import * as https from 'node:https';
import {DAIKIN_OIDC_CONFIG, RateLimitStatus, GatewayDevice, OAuthProvider} from './daikin-types';
import {
    HTTP_STATUS,
    DEFAULT_RETRY_AFTER_SECONDS,
    MS_PER_SECOND,
    MAX_RATE_LIMIT_BLOCK_SECONDS,
    MAX_RETRY_ATTEMPTS,
    RETRY_BASE_DELAY_MS,
    RETRY_MAX_DELAY_MS,
} from '../constants';

export class RateLimitedError extends Error {
    constructor(
        message: string,
        public readonly retryAfter: number,
    ) {
        super(message);
        this.name = 'RateLimitedError';
    }
}

export class ApiTimeoutError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly attemptsMade: number,
    ) {
        super(message);
        this.name = 'ApiTimeoutError';
    }
}

export class DaikinApi {
    private blockedUntil = 0;
    private isRefreshing = false;

    constructor(
        private readonly oauth: OAuthProvider,
        private readonly onRateLimitStatus?: (status: RateLimitStatus) => void,
    ) {}

    // =========================================================================
    // Static utility methods (for use by homebridge-ui)
    // =========================================================================

    /**
     * Make a static GET request with access token (for UI)
     */
    static async requestStatic(
        path: string,
        accessToken: string,
    ): Promise<{ data: unknown; headers: Record<string, string | string[] | undefined>; rateLimit: RateLimitStatus }> {
        const url = `${DAIKIN_OIDC_CONFIG.apiBaseUrl}${path}`;

        const response = await DaikinApi.makeStaticRequest(url, accessToken);

        const rateLimit: RateLimitStatus = {
            limitMinute: DaikinApi.parseHeaderStatic(response.headers['x-ratelimit-limit-minute']),
            remainingMinute: DaikinApi.parseHeaderStatic(response.headers['x-ratelimit-remaining-minute']),
            limitDay: DaikinApi.parseHeaderStatic(response.headers['x-ratelimit-limit-day']),
            remainingDay: DaikinApi.parseHeaderStatic(response.headers['x-ratelimit-remaining-day']),
        };

        if (response.statusCode === HTTP_STATUS.UNAUTHORIZED) {
            throw new Error('Token expired or invalid');
        }
        if (response.statusCode === HTTP_STATUS.TOO_MANY_REQUESTS) {
            throw new Error('Rate limit exceeded');
        }
        if (response.statusCode >= 400) {
            throw new Error(`API error: ${response.statusCode}`);
        }

        return {
            data: response.body ? JSON.parse(response.body) : null,
            headers: response.headers,
            rateLimit,
        };
    }

    private static parseHeaderStatic(value: string | string[] | undefined): number | undefined {
        if (!value) return undefined;
        const str = Array.isArray(value) ? value[0] : value;
        const num = parseInt(str, 10);
        return isNaN(num) ? undefined : num;
    }

    private static makeStaticRequest(
        url: string,
        accessToken: string,
    ): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);

            const options: https.RequestOptions = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve({
                    statusCode: res.statusCode || 500,
                    body: data,
                    headers: res.headers,
                }));
            });

            req.on('error', reject);
            req.end();
        });
    }

    // =========================================================================
    // Instance methods
    // =========================================================================

    /**
     * Get all gateway devices
     */
    async getDevices(): Promise<GatewayDevice[]> {
        return this.request<GatewayDevice[]>('/v1/gateway-devices');
    }

    /**
     * Update device data (PATCH request)
     */
    async updateDevice(
        deviceId: string,
        embeddedId: string,
        dataPoint: string,
        value: unknown,
    ): Promise<void> {
        const path = `/v1/gateway-devices/${deviceId}/management-points/${embeddedId}/characteristics/${dataPoint}`;
        await this.request(path, 'PATCH', {value});
    }

    /**
     * Check if we're rate limited
     */
    isRateLimited(): boolean {
        return this.blockedUntil > Date.now();
    }

    /**
     * Get time until rate limit is lifted
     */
    getRateLimitRetryAfter(): number {
        return Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / MS_PER_SECOND));
    }

    /**
     * Calculate delay for exponential backoff with jitter
     */
    private getRetryDelay(attempt: number): number {
        const exponentialDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * RETRY_BASE_DELAY_MS;
        return Math.min(exponentialDelay + jitter, RETRY_MAX_DELAY_MS);
    }

    /**
     * Sleep for a specified duration
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if status code is a gateway/timeout error that can be retried
     */
    private isGatewayError(statusCode: number): boolean {
        return statusCode === HTTP_STATUS.BAD_GATEWAY ||
               statusCode === HTTP_STATUS.SERVICE_UNAVAILABLE ||
               statusCode === HTTP_STATUS.GATEWAY_TIMEOUT;
    }

    /**
     * Get human-readable name for gateway error status codes
     */
    private getGatewayErrorName(statusCode: number): string {
        switch (statusCode) {
            case HTTP_STATUS.BAD_GATEWAY:
                return 'Bad Gateway';
            case HTTP_STATUS.SERVICE_UNAVAILABLE:
                return 'Service Unavailable';
            case HTTP_STATUS.GATEWAY_TIMEOUT:
                return 'Gateway Timeout';
            default:
                return 'Gateway Error';
        }
    }

    /**
     * Make an authenticated API request
     */
    private async request<T>(
        path: string,
        method: 'GET' | 'PATCH' | 'POST' | 'DELETE' = 'GET',
        body?: unknown,
        retryCount = 0,
    ): Promise<T> {
        // Check rate limit
        if (this.isRateLimited()) {
            const retryAfter = this.getRateLimitRetryAfter();
            throw new RateLimitedError(
                `API request blocked due to rate limit. Retry after ${retryAfter} seconds.`,
                retryAfter,
            );
        }

        const accessToken = await this.oauth.getAccessToken();
        const url = `${DAIKIN_OIDC_CONFIG.apiBaseUrl}${path}`;

        const response = await this.makeRequest(url, method, accessToken, body);

        // Parse rate limit headers
        const rateLimit: RateLimitStatus = {
            limitMinute: this.parseHeader(response.headers['x-ratelimit-limit-minute']),
            remainingMinute: this.parseHeader(response.headers['x-ratelimit-remaining-minute']),
            limitDay: this.parseHeader(response.headers['x-ratelimit-limit-day']),
            remainingDay: this.parseHeader(response.headers['x-ratelimit-remaining-day']),
        };

        if (this.onRateLimitStatus) {
            this.onRateLimitStatus(rateLimit);
        }

        // Handle response codes
        switch (response.statusCode) {
            case HTTP_STATUS.OK:
            case HTTP_STATUS.NO_CONTENT:
                return response.body ? JSON.parse(response.body) : null;

            case HTTP_STATUS.BAD_REQUEST:
                throw new Error(`Bad Request (${HTTP_STATUS.BAD_REQUEST}): ${response.body || 'No response body'}`);

            case HTTP_STATUS.UNAUTHORIZED:
                // If we've exhausted retries or already refreshing, give up
                if (retryCount >= MAX_RETRY_ATTEMPTS || this.isRefreshing) {
                    throw new Error(`Unauthorized (${HTTP_STATUS.UNAUTHORIZED}): Token expired or invalid`);
                }
                // Try to refresh the token and retry the request with exponential backoff
                try {
                    this.isRefreshing = true;
                    await this.oauth.refreshToken();
                    this.isRefreshing = false;
                    // Apply exponential backoff delay before retry
                    const delay = this.getRetryDelay(retryCount);
                    await this.sleep(delay);
                    return this.request<T>(path, method, body, retryCount + 1);
                } catch {
                    this.isRefreshing = false;
                    throw new Error(`Unauthorized (${HTTP_STATUS.UNAUTHORIZED}): Token refresh failed. Please re-authenticate.`);
                }

            case HTTP_STATUS.NOT_FOUND:
                throw new Error(`Not Found (${HTTP_STATUS.NOT_FOUND}): ${response.body || 'Resource not found'}`);

            case HTTP_STATUS.CONFLICT:
                throw new Error(`Conflict (${HTTP_STATUS.CONFLICT}): ${response.body || 'Request conflict'}`);

            case HTTP_STATUS.UNPROCESSABLE_ENTITY:
                throw new Error(`Unprocessable Entity (${HTTP_STATUS.UNPROCESSABLE_ENTITY}): ${response.body || 'Invalid request'}`);

            case HTTP_STATUS.TOO_MANY_REQUESTS: {
                const retryAfter = this.parseHeader(response.headers['retry-after']) || DEFAULT_RETRY_AFTER_SECONDS;
                const blockedFor = Math.min(retryAfter, MAX_RATE_LIMIT_BLOCK_SECONDS);
                this.blockedUntil = Date.now() + blockedFor * MS_PER_SECOND;
                throw new RateLimitedError(
                    `Rate limited. Retry after ${retryAfter} seconds.`,
                    blockedFor,
                );
            }

            case HTTP_STATUS.BAD_GATEWAY:
            case HTTP_STATUS.SERVICE_UNAVAILABLE:
            case HTTP_STATUS.GATEWAY_TIMEOUT: {
                const errorName = this.getGatewayErrorName(response.statusCode);
                // If we've exhausted retries, throw ApiTimeoutError
                if (retryCount >= MAX_RETRY_ATTEMPTS) {
                    throw new ApiTimeoutError(
                        `${errorName} (${response.statusCode}): The Daikin API is temporarily unavailable after ${retryCount + 1} attempts.`,
                        response.statusCode,
                        retryCount + 1,
                    );
                }
                // Retry with exponential backoff
                const delay = this.getRetryDelay(retryCount);
                await this.sleep(delay);
                return this.request<T>(path, method, body, retryCount + 1);
            }

            default:
                throw new Error(`Unexpected API error (${response.statusCode}): ${response.body}`);
        }
    }

    private parseHeader(value: string | string[] | undefined): number | undefined {
        if (!value) return undefined;
        const str = Array.isArray(value) ? value[0] : value;
        const num = parseInt(str, 10);
        return isNaN(num) ? undefined : num;
    }

    private makeRequest(
        url: string,
        method: string,
        accessToken: string,
        body?: unknown,
    ): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const bodyStr = body ? JSON.stringify(body) : undefined;

            const options: https.RequestOptions = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                    ...(bodyStr && {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(bodyStr),
                    }),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve({
                    statusCode: res.statusCode || 500,
                    body: data,
                    headers: res.headers,
                }));
            });

            req.on('error', reject);

            if (bodyStr) {
                req.write(bodyStr);
            }

            req.end();
        });
    }
}
