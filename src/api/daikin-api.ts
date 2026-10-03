/**
 * Daikin Cloud API Client
 *
 * Handles REST API calls to the Daikin Cloud.
 */

import { z } from 'zod';
import type { RateLimitStatus, GatewayDevice, OAuthProvider } from './daikin-types';
import { DAIKIN_OIDC_CONFIG } from './daikin-types';
import { GatewayDeviceSchema } from './daikin-schemas';
import { httpRequest } from './http-transport';
import {
  HTTP_STATUS,
  DEFAULT_RETRY_AFTER_SECONDS,
  MS_PER_SECOND,
  MAX_RATE_LIMIT_BLOCK_SECONDS,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  WRITE_INTER_REQUEST_DELAY_MS,
} from '../constants';
import { sleep } from '../utils/sleep';

/** Options for a single API request */
interface RequestOptions {
  /**
   * Retry on 502/503/504 with exponential backoff. Defaults to true for
   * writes (a dropped write would otherwise be lost) and false for GETs
   * (the next poll is the retry, so retrying only burns the daily quota).
   */
  retryGatewayErrors?: boolean;
}

/** A queued PATCH that has not started yet and can still absorb newer values */
interface PendingWrite {
  body: { value: unknown; path?: string };
  promise?: Promise<void>;
}

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
  private refreshPromise: Promise<void> | null = null;
  // Per-device write queues: serializes PATCH requests for each device independently,
  // so multiple devices can write in parallel while each device's writes are ordered.
  private writeQueues: Map<string, Promise<unknown>> = new Map();
  // Writes queued but not yet sent, keyed by device/management point/data point/path.
  // A newer write for the same key replaces the queued value (last write wins).
  private pendingWrites: Map<string, PendingWrite> = new Map();

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
    if (!value) {
      return undefined;
    }
    const str = Array.isArray(value) ? value[0] : value;
    const num = parseInt(str, 10);
    return isNaN(num) ? undefined : num;
  }

  private static makeStaticRequest(
    url: string,
    accessToken: string,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
    return httpRequest(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });
  }

  // =========================================================================
  // Instance methods
  // =========================================================================

  /**
     * Get all gateway devices with runtime validation.
     *
     * Gateway errors (5xx) are not retried by default: for periodic polling the
     * next poll is the retry. Pass `retryGatewayErrors: true` for one-off reads
     * (e.g. initial discovery) where a transient failure would be costly.
     */
  async getDevices(options: RequestOptions = {}): Promise<GatewayDevice[]> {
    const rawDevices = await this.request<unknown[]>('/v1/gateway-devices', 'GET', undefined, 0, options);
    return z.array(GatewayDeviceSchema).parse(rawDevices);
  }

  /**
     * Update device data (PATCH request)
     *
     * @param deviceId - The device ID
     * @param embeddedId - The management point embedded ID (e.g., 'climateControl')
     * @param dataPoint - The data point/characteristic name (e.g., 'temperatureControl')
     * @param value - The value to set
     * @param dataPath - Optional path within the data point (e.g., '/operationModes/heating/setpoints/roomTemperature')
     */
  async updateDevice(
    deviceId: string,
    embeddedId: string,
    dataPoint: string,
    value: unknown,
    dataPath?: string,
  ): Promise<void> {
    const urlPath = `${this.managementPointPath(deviceId, embeddedId)}/characteristics/${encodeURIComponent(dataPoint)}`;
    const body = dataPath ? { value, path: dataPath } : { value };
    const key = `${deviceId}|${embeddedId}|${dataPoint}|${dataPath ?? ''}`;

    // Coalesce: a queued-but-unsent write to the same target just takes the new value,
    // and both callers share the outcome of the single request that is sent.
    const pending = this.pendingWrites.get(key);
    if (pending?.promise) {
      pending.body = body;
      return pending.promise;
    }

    const entry: PendingWrite = { body };
    this.pendingWrites.set(key, entry);
    entry.promise = this.enqueueWriteForDevice(deviceId, () => {
      // Once the request starts, later writes must queue behind it instead of merging.
      this.pendingWrites.delete(key);
      return this.request<void>(urlPath, 'PATCH', entry.body);
    });
    return entry.promise;
  }

  /**
     * Enable or disable holiday (away) mode on a management point.
     *
     * Uses the dedicated holiday-mode endpoint (POST) rather than the
     * per-characteristic PATCH used by updateDevice. Only `enabled` is required;
     * optional startDate/endDate (YYYY-MM-DD) bound the holiday period and are
     * omitted from the body when undefined.
     *
     * @param deviceId - The device ID
     * @param embeddedId - The management point embedded ID (e.g., 'climateControl')
     * @param body - The holiday mode payload
     */
  async setHolidayMode(
    deviceId: string,
    embeddedId: string,
    body: { enabled: boolean; startDate?: string; endDate?: string },
  ): Promise<void> {
    const urlPath = `${this.managementPointPath(deviceId, embeddedId)}/holiday-mode`;
    await this.enqueueWriteForDevice(deviceId, () => this.request(urlPath, 'POST', body));
  }

  /**
     * Trigger installation of a staged firmware update on a management point.
     *
     * Firmware installs use a dedicated PUT sub-resource with an empty body
     * (mirroring the official Onecta app) rather than a characteristic PATCH.
     * The firmwareId is the `firmwareUpdate.value.id` UUID from the device
     * payload, which is only present while an update is staged by Daikin.
     *
     * @param deviceId - The device ID
     * @param embeddedId - The management point embedded ID (e.g., 'gateway')
     * @param firmwareId - The staged update's id from firmwareUpdate.value.id
     */
  async triggerFirmwareUpdate(deviceId: string, embeddedId: string, firmwareId: string): Promise<void> {
    const urlPath = `${this.managementPointPath(deviceId, embeddedId)}/firmware/${encodeURIComponent(firmwareId)}`;
    await this.enqueueWriteForDevice(deviceId, () => this.request(urlPath, 'PUT'));
  }

  /**
   * Base path of a management point. IDs come from cloud responses and are
   * encoded so a '/' or '?' in them cannot change which endpoint is hit.
   */
  private managementPointPath(deviceId: string, embeddedId: string): string {
    return `/v1/gateway-devices/${encodeURIComponent(deviceId)}/management-points/${encodeURIComponent(embeddedId)}`;
  }

  /**
   * Serializes write requests per device through a queue with a fixed inter-request delay.
   * Each device has its own queue so writes for different devices run in parallel,
   * while writes for the same device are ordered and rate-limited.
   */
  private enqueueWriteForDevice<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    const current = this.writeQueues.get(deviceId) ?? Promise.resolve();
    const queued = current
      .catch(() => {})
      .then(() => fn())
      .then(
        async (val) => {
          await sleep(WRITE_INTER_REQUEST_DELAY_MS);
          return val;
        },
        async (err) => {
          await sleep(WRITE_INTER_REQUEST_DELAY_MS);
          throw err;
        },
      );
    this.writeQueues.set(deviceId, queued.catch(() => {}));
    return queued;
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
     * Translate well-known Onecta 400 error codes into actionable messages
     */
  private describeBadRequest(body: string): string {
    if (this.isReadOnlyRejection(body)) {
      return 'The unit is temporarily read-only — it is powered off, updating its firmware, '
        + 'or locked by another controller. It will accept commands again once it is back online.';
    }
    return `Bad Request (${HTTP_STATUS.BAD_REQUEST}): ${body || 'No response body'}`;
  }

  private isReadOnlyRejection(body: string): boolean {
    try {
      return JSON.parse(body)?.code === 'READ_ONLY_CHARACTERISTIC';
    } catch {
      return false;
    }
  }

  /**
     * Make an authenticated API request
     */
  private async request<T>(
    path: string,
    method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
    retryCount = 0,
    options: RequestOptions = {},
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

    // Only report when the response actually carried rate-limit headers
    if (this.onRateLimitStatus && Object.values(rateLimit).some(v => v !== undefined)) {
      this.onRateLimitStatus(rateLimit);
    }

    // Handle response codes
    switch (response.statusCode) {
      case HTTP_STATUS.OK:
      case HTTP_STATUS.NO_CONTENT:
        return response.body ? JSON.parse(response.body) : null as unknown as T;

      case HTTP_STATUS.BAD_REQUEST:
        throw new Error(this.describeBadRequest(response.body));

      case HTTP_STATUS.UNAUTHORIZED:
        // If we've exhausted retries, give up
        if (retryCount >= MAX_RETRY_ATTEMPTS) {
          throw new Error(`Unauthorized (${HTTP_STATUS.UNAUTHORIZED}): Token expired or invalid`);
        }
        // Deduplicate concurrent refresh requests using a shared promise
        try {
          if (!this.refreshPromise) {
            this.refreshPromise = this.oauth.refreshToken().then(
              () => {
                this.refreshPromise = null;
              },
              (err) => {
                this.refreshPromise = null;
                throw err;
              },
            );
          }
          await this.refreshPromise;
          // Apply exponential backoff delay before retry
          const delay = this.getRetryDelay(retryCount);
          await sleep(delay);
          return this.request<T>(path, method, body, retryCount + 1, options);
        } catch {
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
        const retryGatewayErrors = options.retryGatewayErrors ?? method !== 'GET';
        // If retries are disabled or exhausted, throw ApiTimeoutError
        if (!retryGatewayErrors || retryCount >= MAX_RETRY_ATTEMPTS) {
          throw new ApiTimeoutError(
            `${errorName} (${response.statusCode}): The Daikin API is temporarily unavailable after ${retryCount + 1} attempts.`,
            response.statusCode,
            retryCount + 1,
          );
        }
        // Retry with exponential backoff
        const delay = this.getRetryDelay(retryCount);
        await sleep(delay);
        return this.request<T>(path, method, body, retryCount + 1, options);
      }

      default:
        throw new Error(`Unexpected API error (${response.statusCode}): ${response.body}`);
    }
  }

  private parseHeader(value: string | string[] | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const str = Array.isArray(value) ? value[0] : value;
    const num = parseInt(str, 10);
    return isNaN(num) ? undefined : num;
  }

  private async makeRequest(
    url: string,
    method: string,
    accessToken: string,
    body?: unknown,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    return httpRequest(url, {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        ...(bodyStr && { 'Content-Type': 'application/json' }),
      },
    }, bodyStr);
  }
}
