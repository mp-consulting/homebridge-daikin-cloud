/**
 * Authentication Constants
 *
 * Constants related to OAuth and authentication.
 */

/** Buffer time before token expiry to trigger refresh (seconds) */
export const TOKEN_EXPIRY_BUFFER_SECONDS = 10;

/** Token file names (stored in the Homebridge storage path), per auth mode */
export const TOKEN_FILES = {
  developer_portal: '.daikin-controller-cloud-tokenset',
  mobile_app: '.daikin-mobile-tokenset',
} as const;

/** Default port for the Developer Portal OAuth callback server */
export const DEFAULT_CALLBACK_PORT = 8582;

/** Default bind address for the OAuth callback server */
export const DEFAULT_CALLBACK_BIND_ADDR = '0.0.0.0';

/** Lifetime of a pending Developer Portal authorization (milliseconds) */
export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
