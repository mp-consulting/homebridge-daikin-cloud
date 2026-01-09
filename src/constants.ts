/**
 * Application Constants
 *
 * Centralized constants to avoid magic numbers throughout the codebase.
 */

// =============================================================================
// Time Constants
// =============================================================================

export const ONE_SECOND_MS = 1000;
export const ONE_MINUTE_MS = ONE_SECOND_MS * 60;
export const ONE_HOUR_MS = ONE_MINUTE_MS * 60;

// =============================================================================
// Default Configuration Values
// =============================================================================

/** Default polling interval in minutes */
export const DEFAULT_UPDATE_INTERVAL_MINUTES = 15;

/** Default delay before force update in milliseconds */
export const DEFAULT_FORCE_UPDATE_DELAY_MS = ONE_SECOND_MS * 60;

/** Rate limit warning threshold - warn when remaining calls fall to this level */
export const RATE_LIMIT_WARNING_THRESHOLD = 20;

// =============================================================================
// Temperature Constants
// =============================================================================

/** Default room temperature when sensor data is unavailable (°C) */
export const DEFAULT_ROOM_TEMPERATURE = 20;

/** Default hot water temperature when sensor data is unavailable (°C) */
export const DEFAULT_HOT_WATER_TEMPERATURE = 40;

/** Default hot water target temperature when unavailable (°C) */
export const DEFAULT_HOT_WATER_TARGET_TEMPERATURE = 50;

/** HomeKit temperature characteristic minimum (°C) */
export const HOMEKIT_TEMP_MIN = 10;

/** HomeKit temperature characteristic maximum (°C) */
export const HOMEKIT_TEMP_MAX = 38;

/** Cooling temperature clamp maximum (°C) */
export const COOLING_TEMP_CLAMP_MAX = 35;

// =============================================================================
// Fan Speed Constants
// =============================================================================

/** Fan speed levels (1-5) to HomeKit percentage multiplier */
export const FAN_SPEED_TO_PERCENTAGE_MULTIPLIER = 20;

/** Minimum fan speed level */
export const FAN_SPEED_MIN = 1;

/** Maximum fan speed level */
export const FAN_SPEED_MAX = 5;

// =============================================================================
// OAuth Constants
// =============================================================================

/** Buffer time before token expiry to trigger refresh (seconds) */
export const TOKEN_EXPIRY_BUFFER_SECONDS = 10;

/** Milliseconds per second for timestamp conversions */
export const MS_PER_SECOND = 1000;

// =============================================================================
// API Constants
// =============================================================================

/** Default retry-after delay when rate limited (seconds) */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

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

/** Maximum rate limit block duration (24 hours in seconds) */
export const MAX_RATE_LIMIT_BLOCK_SECONDS = 86400;

// =============================================================================
// Retry Constants (Exponential Backoff)
// =============================================================================

/** Maximum number of retry attempts for API requests */
export const MAX_RETRY_ATTEMPTS = 3;

/** Base delay for exponential backoff (milliseconds) */
export const RETRY_BASE_DELAY_MS = 1000;

/** Maximum delay for exponential backoff (milliseconds) */
export const RETRY_MAX_DELAY_MS = 10000;
