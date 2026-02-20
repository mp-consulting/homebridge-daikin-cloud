/**
 * API Constants
 *
 * Constants related to API communication, rate limiting, and retries.
 */

/** HTTP Status Codes */
export const HTTP_STATUS = {
    OK: 200,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
} as const;

/** Default retry-after delay when rate limited (seconds) */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** Maximum rate limit block duration (24 hours in seconds) */
export const MAX_RATE_LIMIT_BLOCK_SECONDS = 86400;

/** Rate limit warning threshold - warn when remaining calls fall to this level */
export const RATE_LIMIT_WARNING_THRESHOLD = 20;

/** Maximum number of retry attempts for API requests */
export const MAX_RETRY_ATTEMPTS = 3;

/** Base delay for exponential backoff (milliseconds) */
export const RETRY_BASE_DELAY_MS = 1000;

/** Maximum delay for exponential backoff (milliseconds) */
export const RETRY_MAX_DELAY_MS = 10000;

/** HTTP request timeout (milliseconds) */
export const HTTP_REQUEST_TIMEOUT_MS = 30000;

/** Daikin WebSocket URL for real-time updates */
export const DAIKIN_WEBSOCKET_URL = 'wss://wsapi.onecta.daikineurope.com';
