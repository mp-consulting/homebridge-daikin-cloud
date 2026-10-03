/**
 * Device Constants
 *
 * Constants related to device characteristics and temperatures.
 */

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

/** Heating temperature clamp minimum (°C) */
export const HEATING_TEMP_CLAMP_MIN = 0;

/** Heating temperature clamp maximum (°C) */
export const HEATING_TEMP_CLAMP_MAX = 25;
