/**
 * Daikin Cloud API Client
 *
 * Handles REST API calls to the Daikin Cloud.
 */

import * as https from 'node:https';
import {DAIKIN_OIDC_CONFIG, RateLimitStatus, GatewayDevice} from './daikin-types';
import {DaikinOAuth} from './daikin-oauth';

export class RateLimitedError extends Error {
    constructor(
        message: string,
        public readonly retryAfter: number,
    ) {
        super(message);
        this.name = 'RateLimitedError';
    }
}

export class DaikinApi {
    private blockedUntil = 0;

    constructor(
        private readonly oauth: DaikinOAuth,
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

        if (response.statusCode === 401) {
            throw new Error('Token expired or invalid');
        }
        if (response.statusCode === 429) {
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
        return Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000));
    }

    /**
     * Make an authenticated API request
     */
    private async request<T>(
        path: string,
        method: 'GET' | 'PATCH' | 'POST' | 'DELETE' = 'GET',
        body?: unknown,
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
            case 200:
            case 204:
                return response.body ? JSON.parse(response.body) : null;

            case 400:
                throw new Error(`Bad Request (400): ${response.body || 'No response body'}`);

            case 401:
                throw new Error('Unauthorized (401): Token expired or invalid');

            case 404:
                throw new Error(`Not Found (404): ${response.body || 'Resource not found'}`);

            case 409:
                throw new Error(`Conflict (409): ${response.body || 'Request conflict'}`);

            case 422:
                throw new Error(`Unprocessable Entity (422): ${response.body || 'Invalid request'}`);

            case 429: {
                const retryAfter = this.parseHeader(response.headers['retry-after']) || 60;
                const blockedFor = Math.min(retryAfter, 86400); // Max 24 hours
                this.blockedUntil = Date.now() + blockedFor * 1000;
                throw new RateLimitedError(
                    `Rate limited. Retry after ${retryAfter} seconds.`,
                    blockedFor,
                );
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
