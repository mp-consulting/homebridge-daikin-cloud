/**
 * Daikin Cloud Controller
 *
 * Main controller that ties together OAuth, API, and device management.
 */

import {EventEmitter} from 'node:events';
import {DaikinClientConfig, RateLimitStatus, TokenSet} from './daikin-types';
import {DaikinOAuth} from './daikin-oauth';
import {DaikinApi, RateLimitedError} from './daikin-api';
import {DaikinCloudDevice} from './daikin-device';

export class DaikinCloudController extends EventEmitter {
    private readonly oauth: DaikinOAuth;
    private readonly api: DaikinApi;
    private devices: DaikinCloudDevice[] = [];

    constructor(config: DaikinClientConfig) {
        super();

        this.oauth = new DaikinOAuth(
            config,
            (tokenSet) => this.emit('token_update', tokenSet),
            (error) => this.emit('error', error.message),
        );

        this.api = new DaikinApi(
            this.oauth,
            (status) => this.emit('rate_limit_status', status),
        );
    }

    /**
     * Check if authenticated
     */
    isAuthenticated(): boolean {
        return this.oauth.isAuthenticated();
    }

    /**
     * Get token expiration date
     */
    getTokenExpiration(): Date | null {
        return this.oauth.getTokenExpiration();
    }

    /**
     * Get current token set
     */
    getTokenSet(): TokenSet | null {
        return this.oauth.getTokenSet();
    }

    /**
     * Build authorization URL
     */
    buildAuthUrl(state?: string): { url: string; state: string } {
        return this.oauth.buildAuthUrl(state);
    }

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCode(code: string): Promise<TokenSet> {
        return this.oauth.exchangeCode(code);
    }

    /**
     * Revoke authentication
     */
    async revokeAuth(): Promise<void> {
        return this.oauth.revokeToken();
    }

    /**
     * Get all cloud devices
     */
    async getCloudDevices(): Promise<DaikinCloudDevice[]> {
        if (!this.oauth.isAuthenticated()) {
            throw new Error('Not authenticated. Please authenticate first.');
        }

        const rawDevices = await this.api.getDevices();

        // Create or update DaikinCloudDevice instances
        this.devices = rawDevices.map(rawDevice => {
            const existingDevice = this.devices.find(d => d.getId() === rawDevice.id);
            if (existingDevice) {
                existingDevice.updateRawData(rawDevice);
                return existingDevice;
            }
            return new DaikinCloudDevice(rawDevice, this.api);
        });

        return this.devices;
    }

    /**
     * Update all device data from the cloud
     */
    async updateAllDeviceData(): Promise<void> {
        await this.getCloudDevices();
    }

    /**
     * Check if rate limited
     */
    isRateLimited(): boolean {
        return this.api.isRateLimited();
    }

    /**
     * Get rate limit retry time
     */
    getRateLimitRetryAfter(): number {
        return this.api.getRateLimitRetryAfter();
    }
}

// Re-export types and errors
export {DaikinCloudDevice} from './daikin-device';
export {RateLimitedError} from './daikin-api';
export {DaikinOAuth} from './daikin-oauth';
export {DaikinApi} from './daikin-api';
export * from './daikin-types';
