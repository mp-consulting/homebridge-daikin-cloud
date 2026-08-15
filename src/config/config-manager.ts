/**
 * Configuration Manager
 *
 * Centralizes configuration management with validation,
 * defaults, and type-safe access to config values.
 */

import type { AuthMode } from '../api/daikin-types';
import { safeValidateData, DaikinControllerConfigSchema } from '../api/daikin-schemas';
import {
  DEFAULT_UPDATE_INTERVAL_MINUTES,
  DEFAULT_FORCE_UPDATE_DELAY_MS,
  ONE_MINUTE_MS,
} from '../constants';

export interface PluginConfig {
    // Platform identification
    platform: string;
    name?: string;

    // Authentication mode
    authMode?: AuthMode;

    // Developer Portal credentials
    clientId?: string;
    clientSecret?: string;
    callbackServerExternalAddress?: string;
    callbackServerPort?: number;
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
    updateIntervalInMinutes?: number;
    forceUpdateDelay?: number;

    // Device exclusions
    excludedDevicesByDeviceId?: string[];

    // Feature toggles
    showPowerfulMode?: boolean;
    showEconoMode?: boolean;
    showStreamerMode?: boolean;
    showOutdoorSilentMode?: boolean;
    showIndoorSilentMode?: boolean;
    showAutoFanMode?: boolean;
    showOscillationSwitch?: boolean;
    showDryMode?: boolean;
    showFanOnlyMode?: boolean;
    showHolidayMode?: boolean;
    showExtraFeatures?: boolean; // Legacy

    // Standalone Fan (Fanv2) service exposing fan speed + oscillation as its own tile
    showSeparateFanControl?: boolean;

    // WebSocket
    enableWebSocket?: boolean;
}

export interface NormalizedConfig {
    authMode: AuthMode;
    updateIntervalMs: number;
    forceUpdateDelayMs: number;
    excludedDeviceIds: Set<string>;
    features: {
        powerfulMode: boolean;
        econoMode: boolean;
        streamerMode: boolean;
        outdoorSilentMode: boolean;
        indoorSilentMode: boolean;
        autoFanMode: boolean;
        oscillationMode: boolean;
        dryMode: boolean;
        fanOnlyMode: boolean;
        holidayMode: boolean;
    };
    websocketEnabled: boolean;
}

export class ConfigManager {
  private readonly config: PluginConfig;
  private normalized: NormalizedConfig | null = null;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  /**
     * Get the normalized configuration with defaults applied
     */
  getNormalized(): NormalizedConfig {
    if (!this.normalized) {
      this.normalized = this.normalize();
    }
    return this.normalized;
  }

  /**
     * Get authentication mode
     */
  getAuthMode(): AuthMode {
    return this.config.authMode === 'mobile_app' ? 'mobile_app' : 'developer_portal';
  }

  /**
     * Check if mobile app mode is enabled
     */
  isMobileAppMode(): boolean {
    return this.getAuthMode() === 'mobile_app';
  }

  /**
     * Check if developer portal mode is enabled
     */
  isDeveloperPortalMode(): boolean {
    return this.getAuthMode() === 'developer_portal';
  }

  /**
     * Get developer portal credentials
     */
  getDeveloperCredentials(): {
        clientId: string;
        clientSecret: string;
        callbackServerExternalAddress: string;
        callbackServerPort: number;
        oidcCallbackServerBindAddr?: string;
    } | null {
    const { clientId, clientSecret, callbackServerExternalAddress, callbackServerPort } = this.config;

    if (!clientId || !clientSecret || !callbackServerExternalAddress) {
      return null;
    }

    return {
      clientId,
      clientSecret,
      callbackServerExternalAddress,
      callbackServerPort: callbackServerPort || 8582,
      oidcCallbackServerBindAddr: this.config.oidcCallbackServerBindAddr,
    };
  }

  /**
     * Get mobile app credentials
     */
  getMobileCredentials(): { email: string; password: string } | null {
    const email = this.getMobileEmail();
    const password = this.getMobilePassword();

    if (!email || !password) {
      return null;
    }

    return { email, password };
  }

  /**
     * Mobile app email, falling back to the legacy `email` key
     */
  getMobileEmail(): string | undefined {
    return this.config.daikinEmail || this.config.email;
  }

  /**
     * Mobile app password, falling back to the legacy `password` key
     */
  getMobilePassword(): string | undefined {
    return this.config.daikinPassword || this.config.password;
  }

  /**
     * Legacy credential keys that are in use because the canonical key is absent
     */
  getLegacyCredentialKeysInUse(): string[] {
    const keys: string[] = [];
    if (!this.config.daikinEmail && this.config.email) {
      keys.push('email');
    }
    if (!this.config.daikinPassword && this.config.password) {
      keys.push('password');
    }
    return keys;
  }

  /**
     * Get update interval in milliseconds
     */
  getUpdateIntervalMs(): number {
    const minutes = this.config.updateIntervalInMinutes || DEFAULT_UPDATE_INTERVAL_MINUTES;
    return ONE_MINUTE_MS * minutes;
  }

  /**
     * Get force update delay in milliseconds
     */
  getForceUpdateDelayMs(): number {
    return this.config.forceUpdateDelay ?? DEFAULT_FORCE_UPDATE_DELAY_MS;
  }

  /**
     * Get excluded device IDs as a Set
     */
  getExcludedDeviceIds(): Set<string> {
    return new Set(this.config.excludedDevicesByDeviceId || []);
  }

  /**
     * Check if a device is excluded
     */
  isDeviceExcluded(deviceId: string): boolean {
    return this.getExcludedDeviceIds().has(deviceId);
  }

  /**
     * Get feature configuration
     */
  getFeatures(): NormalizedConfig['features'] {
    const legacy = this.config.showExtraFeatures === true;

    return {
      powerfulMode: this.config.showPowerfulMode ?? legacy,
      econoMode: this.config.showEconoMode ?? legacy,
      streamerMode: this.config.showStreamerMode ?? legacy,
      outdoorSilentMode: this.config.showOutdoorSilentMode ?? legacy,
      indoorSilentMode: this.config.showIndoorSilentMode ?? legacy,
      autoFanMode: this.config.showAutoFanMode ?? legacy,
      oscillationMode: this.config.showOscillationSwitch ?? legacy,
      dryMode: this.config.showDryMode ?? legacy,
      fanOnlyMode: this.config.showFanOnlyMode ?? legacy,
      holidayMode: this.config.showHolidayMode ?? legacy,
    };
  }

  /**
     * Check if WebSocket is enabled
     */
  isWebSocketEnabled(): boolean {
    return this.config.enableWebSocket !== false;
  }

  /**
     * Validate configuration using Zod schemas
     */
  validateWithZod(): { valid: boolean; errors: string[] } {
    const configData = {
      authMode: this.getAuthMode(),
      tokenFilePath: '', // This will be set by the controller
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      callbackServerExternalAddress: this.config.callbackServerExternalAddress,
      callbackServerPort: this.config.callbackServerPort,
      oidcCallbackServerBindAddr: this.config.oidcCallbackServerBindAddr,
      email: this.getMobileEmail(),
      password: this.getMobilePassword(),
    };

    const result = safeValidateData(DaikinControllerConfigSchema, configData);
    if (!result.success) {
      return {
        valid: false,
        errors: [result.error],
      };
    }

    return { valid: true, errors: [] };
  }

  /**
     * Validate configuration
     */
  validate(): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const authMode = this.getAuthMode();

    // Validate authentication credentials
    if (authMode === 'developer_portal') {
      if (!this.config.clientId) {
        errors.push('Client ID is required for Developer Portal mode');
      }
      if (!this.config.clientSecret) {
        errors.push('Client Secret is required for Developer Portal mode');
      }
      if (!this.config.callbackServerExternalAddress) {
        errors.push('Callback Server Address is required for Developer Portal mode');
      }
      // Warn about localhost
      if (this.config.callbackServerExternalAddress === 'localhost' ||
                this.config.callbackServerExternalAddress === '127.0.0.1') {
        errors.push('Callback address cannot be localhost. Use your external IP or domain.');
      }
    } else if (authMode === 'mobile_app') {
      if (!this.getMobileEmail()) {
        errors.push('Email is required for Mobile App mode (config key: "daikinEmail")');
      }
      if (!this.getMobilePassword()) {
        errors.push('Password is required for Mobile App mode (config key: "daikinPassword")');
      }
      const legacyKeys = this.getLegacyCredentialKeysInUse();
      if (legacyKeys.length > 0) {
        warnings.push(
          `Using deprecated config key(s) ${legacyKeys.map(k => `"${k}"`).join(' and ')}. `
          + 'Rename to "daikinEmail"/"daikinPassword" — the old names will stop working in a future release.',
        );
      }
    }

    // Validate port
    if (this.config.callbackServerPort !== undefined) {
      const port = typeof this.config.callbackServerPort === 'string'
        ? parseInt(this.config.callbackServerPort, 10)
        : this.config.callbackServerPort;

      if (isNaN(port) || port < 1 || port > 65535) {
        errors.push(`Invalid port number: ${this.config.callbackServerPort}. Must be between 1 and 65535.`);
      } else if (port < 1024) {
        warnings.push(`Port ${port} is privileged (< 1024) and may require root permissions.`);
      }
    }

    // Validate update interval
    if (this.config.updateIntervalInMinutes !== undefined) {
      const interval = this.config.updateIntervalInMinutes;
      if (interval < 1 || interval > 60) {
        errors.push(`Update interval must be between 1 and 60 minutes, got: ${interval}`);
      } else if (authMode === 'developer_portal' && interval < 15) {
        warnings.push(`Update interval ${interval}min may exceed Developer Portal rate limit (200 calls/day). Recommended: 15+ minutes.`);
      }
    }

    // Validate force update delay
    if (this.config.forceUpdateDelay !== undefined) {
      const delay = this.config.forceUpdateDelay;
      const delaySeconds = Math.floor(delay / 1000);
      if (delaySeconds < 1 || delaySeconds > 300) {
        errors.push(`Force update delay must be between 1 and 300 seconds, got: ${delaySeconds}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
     * Normalize the configuration with all defaults applied
     */
  private normalize(): NormalizedConfig {
    return {
      authMode: this.getAuthMode(),
      updateIntervalMs: this.getUpdateIntervalMs(),
      forceUpdateDelayMs: this.getForceUpdateDelayMs(),
      excludedDeviceIds: this.getExcludedDeviceIds(),
      features: this.getFeatures(),
      websocketEnabled: this.isWebSocketEnabled(),
    };
  }

  /**
     * Get raw config value (escape hatch for migration)
     */
  getRawConfig(): PluginConfig {
    return this.config;
  }
}
