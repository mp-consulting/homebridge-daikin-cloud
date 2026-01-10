/**
 * Time Constants
 *
 * All time-related constants for consistency across the application.
 */

export const ONE_SECOND_MS = 1000;
export const ONE_MINUTE_MS = ONE_SECOND_MS * 60;
export const ONE_HOUR_MS = ONE_MINUTE_MS * 60;
export const ONE_DAY_MS = ONE_HOUR_MS * 24;

/** Milliseconds per second for timestamp conversions */
export const MS_PER_SECOND = 1000;

/** Default polling interval in minutes */
export const DEFAULT_UPDATE_INTERVAL_MINUTES = 15;

/** Default delay before force update in milliseconds */
export const DEFAULT_FORCE_UPDATE_DELAY_MS = ONE_SECOND_MS * 60;
