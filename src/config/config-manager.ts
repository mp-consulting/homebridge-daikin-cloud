/**
 * Configuration Manager
 *
 * Centralizes configuration management with validation,
 * defaults, and type-safe access to config values.
 */

import {AuthMode} from '../api/daikin-types';
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
    showDryMode?: boolean;
    showFanOnlyMode?: boolean;
    showExtraFeatures?: boolean; // Legacy

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
        dryMode: boolean;
        fanOnlyMode: boolean;
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
        const {clientId, clientSecret, callbackServerExternalAddress, callbackServerPort} = this.config;

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
        const {daikinEmail, daikinPassword} = this.config;

        if (!daikinEmail || !daikinPassword) {
            return null;
        }

        return {
            email: daikinEmail,
            password: daikinPassword,
        };
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
            dryMode: this.config.showDryMode ?? legacy,
            fanOnlyMode: this.config.showFanOnlyMode ?? legacy,
        };
    }

    /**
     * Check if WebSocket is enabled
     */
    isWebSocketEnabled(): boolean {
        return this.config.enableWebSocket !== false;
    }

    /**
     * Validate configuration
     */
    validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        const authMode = this.getAuthMode();

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
        } else if (authMode === 'mobile_app') {
            if (!this.config.daikinEmail) {
                errors.push('Email is required for Mobile App mode');
            }
            if (!this.config.daikinPassword) {
                errors.push('Password is required for Mobile App mode');
            }
        }

        return {
            valid: errors.length === 0,
            errors,
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
