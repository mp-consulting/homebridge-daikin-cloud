/**
 * Configuration Manager
 *
 * Single source of truth for the plugin configuration: the raw Homebridge
 * platform config is normalized once (type coercion, schema bounds, defaults)
 * and every consumer reads it through the typed getters below.
 */

import type { AuthMode, DaikinControllerConfig } from '../api/daikin-types';
import type { HttpTransportMode } from '../api/http-transport';
import {
  DEFAULT_UPDATE_INTERVAL_MINUTES,
  DEFAULT_FORCE_UPDATE_DELAY_MS,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_CALLBACK_BIND_ADDR,
  ONE_MINUTE_MS,
  ONE_SECOND_MS,
} from '../constants';
import { StringUtils } from '../utils/strings';

/**
 * Per-feature config toggles (the `show*` keys of config.schema.json).
 *
 * - `extra`: switches that follow the legacy `showExtraFeatures` catch-all when
 *   their own key is not set.
 * - `standalone`: default off and never follow `showExtraFeatures` (a separate
 *   Fan tile, and a switch that installs firmware).
 *
 * Kept in sync with config.schema.json and homebridge-ui/public/script.js by
 * test/unit/config/feature-config-keys.test.ts.
 */
export const FEATURE_CONFIG_KEYS = {
  extra: [
    'showPowerfulMode',
    'showEconoMode',
    'showStreamerMode',
    'showOutdoorSilentMode',
    'showIndoorSilentMode',
    'showAutoFanMode',
    'showOscillationSwitch',
    'showDryMode',
    'showFanOnlyMode',
    'showHolidayMode',
  ],
  standalone: [
    'showSeparateFanControl',
    'showFirmwareUpdateSwitch',
  ],
} as const;

export type ExtraFeatureConfigKey = typeof FEATURE_CONFIG_KEYS.extra[number];
export type StandaloneFeatureConfigKey = typeof FEATURE_CONFIG_KEYS.standalone[number];
export type FeatureConfigKey = ExtraFeatureConfigKey | StandaloneFeatureConfigKey;

/** Schema bounds (config.schema.json) the numeric settings are clamped to */
const UPDATE_INTERVAL_MINUTES_MIN = 1;
const UPDATE_INTERVAL_MINUTES_MAX = 60;
const FORCE_UPDATE_DELAY_MS_MIN = 5 * ONE_SECOND_MS;
const FORCE_UPDATE_DELAY_MS_MAX = 300 * ONE_SECOND_MS;
const PORT_MIN = 1;
const PORT_MAX = 65535;
const PRIVILEGED_PORT_MAX = 1023;
const DEVELOPER_PORTAL_RECOMMENDED_INTERVAL_MINUTES = 15;

/**
 * Raw plugin config as written by Homebridge. Values come from a user-edited
 * JSON file, so the declared types are what the schema intends, not a guarantee.
 */
export interface PluginConfig extends Partial<Record<FeatureConfigKey, boolean | null>> {
  // Platform identification
  platform: string;
  name?: string;

  // Authentication mode
  authMode?: AuthMode;

  // Developer Portal credentials
  clientId?: string;
  clientSecret?: string;
  callbackServerExternalAddress?: string;
  callbackServerPort?: number | string;
  oidcCallbackServerBindAddr?: string;

  // Mobile App credentials
  daikinEmail?: string;
  daikinPassword?: string;

  /**
   * Legacy aliases. The README documented `email`/`password` up to v1.3.31
   * while the code has always read `daikinEmail`/`daikinPassword`, so configs
   * written against the docs silently looked "unconfigured". Accepted as a
   * fallback (with a warning) so those configs keep working.
   */
  email?: string;
  password?: string;

  // Update intervals
  updateIntervalInMinutes?: number | string;
  forceUpdateDelay?: number | string;

  // Device exclusions
  excludedDevicesByDeviceId?: string[];

  // Legacy catch-all for the `extra` feature toggles
  showExtraFeatures?: boolean | null;

  // HTTP transport: 'node' (default) or 'curl' subprocess — escape hatch for
  // networks whose WAF drops Node's TLS fingerprint (GitHub issue #6).
  httpTransport?: HttpTransportMode;

  // WebSocket
  enableWebSocket?: boolean;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface NormalizedConfig {
  name?: string;
  authMode: AuthMode;
  httpTransport?: HttpTransportMode;
  clientId?: string;
  clientSecret?: string;
  callbackServerExternalAddress?: string;
  callbackServerPort: number;
  oidcCallbackServerBindAddr: string;
  email?: string;
  password?: string;
  updateIntervalMs: number;
  forceUpdateDelayMs: number;
  excludedDeviceIds: ReadonlySet<string>;
  features: Readonly<Record<FeatureConfigKey, boolean>>;
  webSocketEnabled: boolean;
}

/** Number from a number or numeric string; NaN for anything else (including '' and null). */
function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  return NaN;
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveAuthMode(config: PluginConfig): AuthMode {
  return config.authMode === 'mobile_app' ? 'mobile_app' : 'developer_portal';
}

/** Parsed port, or undefined when it is not an integer within 1-65535. */
function parsePort(value: unknown): number | undefined {
  const port = toNumber(value);
  return Number.isInteger(port) && port >= PORT_MIN && port <= PORT_MAX ? port : undefined;
}

/** Update interval in minutes: unset/0/non-numeric uses the default, the rest is clamped to the schema bounds. */
function resolveUpdateIntervalMinutes(value: unknown): number {
  const minutes = toNumber(value);
  if (!Number.isFinite(minutes) || minutes === 0) {
    return DEFAULT_UPDATE_INTERVAL_MINUTES;
  }
  return clamp(minutes, UPDATE_INTERVAL_MINUTES_MIN, UPDATE_INTERVAL_MINUTES_MAX);
}

/** Force update delay in ms: unset/0/non-numeric uses the default, the rest is clamped to the schema bounds. */
function resolveForceUpdateDelayMs(value: unknown): number {
  const delay = toNumber(value);
  if (!Number.isFinite(delay) || delay === 0) {
    return DEFAULT_FORCE_UPDATE_DELAY_MS;
  }
  return clamp(delay, FORCE_UPDATE_DELAY_MS_MIN, FORCE_UPDATE_DELAY_MS_MAX);
}

/**
 * Feature toggle semantics, defined once:
 * - the per-feature key is a boolean: that value
 * - otherwise (absent, null, anything else): `extra` features follow
 *   `showExtraFeatures`, `standalone` features are off
 */
function resolveFeatures(config: PluginConfig): Record<FeatureConfigKey, boolean> {
  const legacy = config.showExtraFeatures === true;
  const features = {} as Record<FeatureConfigKey, boolean>;
  for (const key of FEATURE_CONFIG_KEYS.extra) {
    const value = config[key];
    features[key] = typeof value === 'boolean' ? value : legacy;
  }
  for (const key of FEATURE_CONFIG_KEYS.standalone) {
    features[key] = config[key] === true;
  }
  return features;
}

function normalize(config: PluginConfig): NormalizedConfig {
  const excluded = Array.isArray(config.excludedDevicesByDeviceId) ? config.excludedDevicesByDeviceId : [];
  return {
    name: nonEmptyString(config.name),
    authMode: resolveAuthMode(config),
    httpTransport: config.httpTransport === 'curl' || config.httpTransport === 'node' ? config.httpTransport : undefined,
    clientId: nonEmptyString(config.clientId),
    clientSecret: nonEmptyString(config.clientSecret),
    callbackServerExternalAddress: nonEmptyString(config.callbackServerExternalAddress),
    callbackServerPort: parsePort(config.callbackServerPort) ?? DEFAULT_CALLBACK_PORT,
    oidcCallbackServerBindAddr: nonEmptyString(config.oidcCallbackServerBindAddr) ?? DEFAULT_CALLBACK_BIND_ADDR,
    email: nonEmptyString(config.daikinEmail) ?? nonEmptyString(config.email),
    password: nonEmptyString(config.daikinPassword) ?? nonEmptyString(config.password),
    updateIntervalMs: resolveUpdateIntervalMinutes(config.updateIntervalInMinutes) * ONE_MINUTE_MS,
    forceUpdateDelayMs: resolveForceUpdateDelayMs(config.forceUpdateDelay),
    excludedDeviceIds: new Set(excluded.filter((id): id is string => typeof id === 'string')),
    features: resolveFeatures(config),
    webSocketEnabled: config.enableWebSocket !== false,
  };
}

/** Legacy credential keys that are in use because the canonical key is absent */
function legacyCredentialKeysInUse(config: PluginConfig): string[] {
  const keys: string[] = [];
  if (!config.daikinEmail && config.email) {
    keys.push('email');
  }
  if (!config.daikinPassword && config.password) {
    keys.push('password');
  }
  return keys;
}

/**
 * Validate a raw plugin config. Pure: also used by the custom UI server
 * (homebridge-ui/server.js) for its /config/validate endpoint.
 *
 * Errors are configurations the plugin cannot work with; out-of-range numeric
 * settings are only warnings, because normalization clamps them.
 */
export function validateConfig(config: PluginConfig): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const authMode = resolveAuthMode(config);

  // Validate authentication credentials
  if (authMode === 'developer_portal') {
    if (!config.clientId) {
      errors.push('Client ID is required for Developer Portal mode');
    }
    if (!config.clientSecret) {
      errors.push('Client Secret is required for Developer Portal mode');
    }
    if (!config.callbackServerExternalAddress) {
      errors.push('Callback Server Address is required for Developer Portal mode');
    } else if (config.callbackServerExternalAddress === 'localhost' || config.callbackServerExternalAddress === '127.0.0.1') {
      // The Daikin redirect must reach this host from the user's browser
      errors.push('Callback address cannot be localhost. Use your external IP or domain.');
    }
  } else {
    if (!config.daikinEmail && !config.email) {
      errors.push('Email is required for Mobile App mode (config key: "daikinEmail")');
    }
    if (!config.daikinPassword && !config.password) {
      errors.push('Password is required for Mobile App mode (config key: "daikinPassword")');
    }
    const legacyKeys = legacyCredentialKeysInUse(config);
    if (legacyKeys.length > 0) {
      warnings.push(
        `Using deprecated config key(s) ${legacyKeys.map(k => `"${k}"`).join(' and ')}. `
        + 'Rename to "daikinEmail"/"daikinPassword" — the old names will stop working in a future release.',
      );
    }
  }

  // Validate port
  if (isSet(config.callbackServerPort)) {
    const port = parsePort(config.callbackServerPort);
    if (port === undefined) {
      errors.push(`Invalid port number: ${config.callbackServerPort}. Must be between ${PORT_MIN} and ${PORT_MAX}.`);
    } else if (port <= PRIVILEGED_PORT_MAX) {
      warnings.push(`Port ${port} is privileged (< 1024) and may require root permissions.`);
    }
  }

  // Validate update interval
  if (isSet(config.updateIntervalInMinutes)) {
    const raw = toNumber(config.updateIntervalInMinutes);
    const minutes = resolveUpdateIntervalMinutes(config.updateIntervalInMinutes);
    if (raw !== minutes) {
      warnings.push(`Update interval must be between ${UPDATE_INTERVAL_MINUTES_MIN} and ${UPDATE_INTERVAL_MINUTES_MAX} minutes, `
        + `got: ${config.updateIntervalInMinutes}. Using ${minutes} minutes.`);
    } else if (authMode === 'developer_portal' && minutes < DEVELOPER_PORTAL_RECOMMENDED_INTERVAL_MINUTES) {
      warnings.push(`Update interval ${minutes}min may exceed Developer Portal rate limit (200 calls/day). Recommended: 15+ minutes.`);
    }
  }

  // Validate force update delay
  if (isSet(config.forceUpdateDelay)) {
    const raw = toNumber(config.forceUpdateDelay);
    const delay = resolveForceUpdateDelayMs(config.forceUpdateDelay);
    if (raw !== delay) {
      warnings.push(`Force update delay must be between ${FORCE_UPDATE_DELAY_MS_MIN} and ${FORCE_UPDATE_DELAY_MS_MAX} ms, `
        + `got: ${config.forceUpdateDelay}. Using ${delay} ms.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export class ConfigManager {
  private readonly config: PluginConfig;
  private readonly normalized: NormalizedConfig;

  constructor(config: PluginConfig) {
    this.config = config;
    this.normalized = normalize(config);
  }

  // ---------------------------------------------------------------------------
  // Platform
  // ---------------------------------------------------------------------------

  /** Platform name as configured in Homebridge */
  getName(): string | undefined {
    return this.normalized.name;
  }

  /** HTTP transport from the config (the DAIKIN_HTTP_TRANSPORT env var still wins, see configureHttpTransport) */
  getHttpTransport(): HttpTransportMode | undefined {
    return this.normalized.httpTransport;
  }

  /** Polling interval in milliseconds, clamped to 1-60 minutes */
  getUpdateIntervalMs(): number {
    return this.normalized.updateIntervalMs;
  }

  /** Delay before refreshing after a change, in milliseconds, clamped to 5-300 seconds */
  getForceUpdateDelayMs(): number {
    return this.normalized.forceUpdateDelayMs;
  }

  /** Whether the device (raw Daikin device ID) is listed in excludedDevicesByDeviceId */
  isDeviceExcluded(deviceId: string): boolean {
    return this.normalized.excludedDeviceIds.has(deviceId);
  }

  /** WebSocket push updates are on unless explicitly disabled */
  isWebSocketEnabled(): boolean {
    return this.normalized.webSocketEnabled;
  }

  // ---------------------------------------------------------------------------
  // Authentication / controller
  // ---------------------------------------------------------------------------

  getAuthMode(): AuthMode {
    return this.normalized.authMode;
  }

  isMobileAppMode(): boolean {
    return this.normalized.authMode === 'mobile_app';
  }

  /** Client ID and secret are present (the minimum to start the Developer Portal controller) */
  hasDeveloperCredentials(): boolean {
    return this.normalized.clientId !== undefined && this.normalized.clientSecret !== undefined;
  }

  /** Mobile app email and password (falling back to the legacy keys), or null when either is missing */
  getMobileCredentials(): { email: string; password: string } | null {
    const { email, password } = this.normalized;
    if (!email || !password) {
      return null;
    }
    return { email, password };
  }

  /** Legacy credential keys that are in use because the canonical key is absent */
  getLegacyCredentialKeysInUse(): string[] {
    return legacyCredentialKeysInUse(this.config);
  }

  /** Configuration for the DaikinCloudController, with defaults applied */
  getControllerConfig(tokenFilePath: string): DaikinControllerConfig {
    const n = this.normalized;
    return {
      authMode: n.authMode,
      tokenFilePath,
      // Developer Portal fields
      clientId: n.clientId,
      clientSecret: n.clientSecret,
      callbackServerExternalAddress: n.callbackServerExternalAddress,
      callbackServerPort: n.callbackServerPort,
      oidcCallbackServerBindAddr: n.oidcCallbackServerBindAddr,
      // Mobile App fields
      email: n.email,
      password: n.password,
    };
  }

  // ---------------------------------------------------------------------------
  // Features
  // ---------------------------------------------------------------------------

  /** Whether a feature switch / service is enabled (see resolveFeatures for the semantics) */
  isFeatureEnabled(key: FeatureConfigKey): boolean {
    return this.normalized.features[key];
  }

  // ---------------------------------------------------------------------------
  // Validation / diagnostics
  // ---------------------------------------------------------------------------

  validate(): ConfigValidationResult {
    return validateConfig(this.config);
  }

  /** The raw config with credentials and device IDs masked, for debug logging */
  getRedactedConfig(): object {
    const config = this.config;
    return {
      ...config,
      clientId: StringUtils.mask(config.clientId),
      clientSecret: StringUtils.mask(config.clientSecret),
      daikinEmail: StringUtils.mask(config.daikinEmail),
      daikinPassword: config.daikinPassword ? '***' : undefined,
      // Legacy aliases, masked too so they never leak into debug logs
      email: StringUtils.mask(config.email),
      password: config.password ? '***' : undefined,
      excludedDevicesByDeviceId: [...this.normalized.excludedDeviceIds].map(deviceId => StringUtils.mask(deviceId)),
    };
  }
}
