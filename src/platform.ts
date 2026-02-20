import {API, Characteristic, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import {AccessoryFactory} from './device';

import {resolve} from 'node:path';
import {StringUtils} from './utils/strings';

import fs from 'node:fs';
import {DaikinCloudRepo, DaikinCloudController, DaikinCloudDevice, DaikinControllerConfig} from './api';
import {UpdateMapper} from './utils/update-mapper';
import {ConfigManager, PluginConfig} from './config/config-manager';
import {
    ONE_MINUTE_MS,
    DEFAULT_UPDATE_INTERVAL_MINUTES,
    DEFAULT_FORCE_UPDATE_DELAY_MS,
    RATE_LIMIT_WARNING_THRESHOLD,
} from './constants';

export type DaikinCloudAccessoryContext = {
    device: DaikinCloudDevice;
};

export class DaikinCloudPlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service;
    public readonly Characteristic: typeof Characteristic;

    public readonly accessories: PlatformAccessory<DaikinCloudAccessoryContext>[] = [];

    public readonly storagePath: string = '';
    public controller: DaikinCloudController | undefined;

    public readonly updateIntervalDelay: number;
    private updateInterval: NodeJS.Timeout | undefined;
    private forceUpdateTimeout: NodeJS.Timeout | undefined;
    private readonly accessoryFactory: AccessoryFactory;
    private readonly updateMapper: UpdateMapper;
    private readonly authMode: 'developer_portal' | 'mobile_app';
    private readonly deviceListeners = new Map<string, () => void>();

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.log.info('--- Daikin info for debugging reasons (enable Debug Mode for more logs) ---');

        this.log.debug('[Platform] Initializing platform:', this.config.name);

        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.storagePath = api.user.storagePath();
        this.updateIntervalDelay = ONE_MINUTE_MS * (this.config.updateIntervalInMinutes || DEFAULT_UPDATE_INTERVAL_MINUTES);
        this.accessoryFactory = new AccessoryFactory(this);
        this.updateMapper = new UpdateMapper(this.log, this.Service, this.Characteristic);

        // Determine authentication mode
        this.authMode = this.config.authMode === 'mobile_app' ? 'mobile_app' : 'developer_portal';
        this.log.info(`[Config] Authentication mode: ${this.authMode}`);

        // Validate configuration
        const configManager = new ConfigManager(this.config as PluginConfig);
        const validation = configManager.validate();
        for (const warning of validation.warnings) {
            this.log.warn(`[Config] ${warning}`);
        }

        // Check if credentials are configured based on auth mode
        if (this.authMode === 'mobile_app') {
            if (!this.config.daikinEmail || !this.config.daikinPassword) {
                this.log.warn('[Config] Daikin email and/or password not configured.');
                this.log.warn('[Config] Please configure the plugin using the Homebridge UI.');
                this.log.info('--------------- End Daikin info for debugging reasons --------------------');
                return;
            }
        } else {
            if (!this.config.clientId || !this.config.clientSecret) {
                this.log.warn('[Config] Client ID and/or Client Secret not configured.');
                this.log.warn('[Config] Please configure the plugin using the Homebridge UI.');
                this.log.info('--------------- End Daikin info for debugging reasons --------------------');
                return;
            }
        }

        // Use different token file for mobile auth to avoid conflicts
        const tokenFileName = this.authMode === 'mobile_app'
            ? '.daikin-mobile-tokenset'
            : '.daikin-controller-cloud-tokenset';
        const tokenFilePath = resolve(this.storagePath, tokenFileName);

        const daikinCloudControllerConfig: DaikinControllerConfig = {
            authMode: this.authMode,
            tokenFilePath,
            // Developer Portal fields
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
            callbackServerExternalAddress: this.config.callbackServerExternalAddress,
            callbackServerPort: this.config.callbackServerPort || 8582,
            oidcCallbackServerBindAddr: this.config.oidcCallbackServerBindAddr,
            // Mobile App fields
            email: this.config.daikinEmail,
            password: this.config.daikinPassword,
        };

        this.log.debug('[Config] Homebridge config', this.getPrivacyFriendlyConfig(this.config));

        fs.stat(tokenFilePath, (err, stats) => {
            if (err) {
                this.log.debug('[Config] Token file does NOT exist.');
                if (this.authMode === 'developer_portal') {
                    this.log.debug('[Config] Please authenticate via the Homebridge UI.');
                }
            } else {
                this.log.debug(`[Config] Token file exists, last modified: ${stats.mtime}`);
            }
        });

        this.controller = new DaikinCloudController(daikinCloudControllerConfig);

        this.api.on('didFinishLaunching', async () => {
            if (!this.controller) {
                return;
            }

            // Handle authentication based on mode
            if (!this.controller.isAuthenticated()) {
                if (this.authMode === 'mobile_app') {
                    // For mobile auth, automatically authenticate using stored credentials
                    this.log.info('[Auth] Authenticating with Daikin Cloud using mobile app credentials...');
                    try {
                        await this.controller.authenticateMobile();
                        this.log.info('[Auth] Authentication successful!');
                    } catch (error) {
                        this.log.error(`[Auth] Authentication failed: ${(error as Error).message}`);
                        this.log.info('--------------- End Daikin info for debugging reasons --------------------');
                        return;
                    }
                } else {
                    this.log.warn('[Auth] Not authenticated. Please use the Homebridge UI to authenticate with Daikin Cloud.');
                    this.log.info('--------------- End Daikin info for debugging reasons --------------------');
                    return;
                }
            }

            this.controller.on('rate_limit_status', (rateLimitStatus) => {
                if (rateLimitStatus.remainingDay && rateLimitStatus.remainingDay <= RATE_LIMIT_WARNING_THRESHOLD) {
                    this.log.warn(`[Rate Limit] Rate limit almost reached, you only have ${rateLimitStatus.remainingDay} calls left today`);
                }
                // Only show minute limits if available (Developer Portal mode)
                const minuteInfo = rateLimitStatus.limitMinute !== undefined
                    ? ` -- this minute: ${rateLimitStatus.remainingMinute}/${rateLimitStatus.limitMinute}`
                    : '';
                this.log.debug(`[Rate Limit] Remaining calls today: ${rateLimitStatus.remainingDay}/${rateLimitStatus.limitDay}${minuteInfo}`);
            });

            this.controller.on('error', (error) => {
                this.log.error(`[Error] ${error}`);
            });

            // WebSocket event handlers
            this.controller.on('websocket_connected', () => {
                this.log.info('[WebSocket] Connected - receiving real-time updates');
            });

            this.controller.on('websocket_disconnected', (info?: { reconnecting: boolean }) => {
                if (info?.reconnecting) {
                    this.log.debug('[WebSocket] Disconnected, attempting to reconnect...');
                } else {
                    this.log.info('[WebSocket] Disconnected');
                }
            });

            this.controller.on('websocket_device_update', (update) => {
                this.log.debug(`[WebSocket] Device update: ${update.deviceId} - ${update.characteristicName}`, JSON.stringify(update.data));
                this.handleWebSocketDeviceUpdate(update);
            });

            const onInvalidGrantError = () => this.onInvalidGrantError(tokenFilePath);
            const devices: DaikinCloudDevice[] = await this.discoverDevices(this.controller, onInvalidGrantError);

            if (devices.length > 0) {
                this.createDevices(devices);
                this.startUpdateDevicesInterval();

                // Enable WebSocket for real-time updates (unless explicitly disabled)
                if (this.config.enableWebSocket !== false) {
                    await this.enableWebSocket();
                }
            }

            this.log.info('--------------- End Daikin info for debugging reasons --------------------');
        });

        // Shutdown handler: clean up timers, WebSocket, and device listeners on platform shutdown
        this.api.on('shutdown', () => {
            this.log.debug('[Platform] Shutting down, cleaning up resources...');
            clearInterval(this.updateInterval);
            clearTimeout(this.forceUpdateTimeout);
            this.controller?.disableWebSocket();
            for (const [uuid, listener] of this.deviceListeners) {
                const accessory = this.accessories.find(a => a.UUID === uuid);
                if (accessory?.context.device) {
                    accessory.context.device.removeListener('updated', listener);
                }
            }
            this.deviceListeners.clear();
        });
    }

    public configureAccessory(accessory: PlatformAccessory<DaikinCloudAccessoryContext>) {
        this.log.info('[Platform] Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }

    private async discoverDevices(controller: DaikinCloudController, onInvalidGrantError: () => void): Promise<DaikinCloudDevice[]> {
        try {
            return await controller.getCloudDevices();
        } catch (error) {
            if (error instanceof Error) {
                error.message = `[API Syncing] Failed to get cloud devices from Daikin Cloud: ${error.message}`;
                this.log.error(error.message);

                if (error.message.includes('invalid_grant')) {
                    onInvalidGrantError();
                }
            }
            return [];
        }
    }

    private createDevices(devices: DaikinCloudDevice[]) {
        for (const device of devices) {
            try {
                const uuid = this.api.hap.uuid.generate(device.getId());
                const deviceModel: string = device.getDescription().deviceModel;

                const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

                this.log.debug('Create Device', deviceModel, JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(device.desc), null, 4));

                if (this.isExcludedDevice(this.config.excludedDevicesByDeviceId, uuid)) {
                    this.log.info(`[Platform] Device with id ${uuid} is excluded, don't add accessory`);
                    if (existingAccessory) {
                        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
                    }
                    continue;
                }

                if (existingAccessory) {
                    this.log.info('[Platform] Restoring existing accessory from cache:', existingAccessory.displayName);

                    // Remove old event listener before reassigning device
                    this.removeDeviceListener(existingAccessory);

                    existingAccessory.context.device = device;
                    this.api.updatePlatformAccessories([existingAccessory]);

                    const {profile} = this.accessoryFactory.createAccessory(existingAccessory);
                    this.log.debug(`[Platform] Created ${profile.displayName} accessory`);

                } else {
                    const climateControlEmbeddedId = device.desc.managementPoints.find(mp => mp.managementPointType === 'climateControl')?.embeddedId || 'climateControl';
                    const nameData = device.getData(climateControlEmbeddedId, 'name', undefined).value as string | undefined;
                    const displayName = StringUtils.isEmpty(nameData) ? deviceModel : nameData!;
                    this.log.info('[Platform] Adding new accessory, deviceModel:', displayName);
                    const accessory = new this.api.platformAccessory<DaikinCloudAccessoryContext>(displayName, uuid);
                    accessory.context.device = device;

                    const {profile} = this.accessoryFactory.createAccessory(accessory);
                    this.log.debug(`[Platform] Created ${profile.displayName} accessory`);

                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                }
            } catch (error) {
                if (error instanceof Error) {
                    this.log.error(`[Platform] Failed to create accessory: ${error.message}`);
                    this.log.debug('[Platform] Error details:', error.stack);
                    this.log.debug('[Platform] Device JSON:', JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(device.desc), null, 2));
                }
            }
        }
    }

    private removeDeviceListener(accessory: PlatformAccessory<DaikinCloudAccessoryContext>) {
        const existingListener = this.deviceListeners.get(accessory.UUID);
        if (existingListener && accessory.context.device) {
            accessory.context.device.removeListener('updated', existingListener);
            this.deviceListeners.delete(accessory.UUID);
        }
    }

    registerDeviceListener(accessory: PlatformAccessory<DaikinCloudAccessoryContext>, listener: () => void) {
        this.deviceListeners.set(accessory.UUID, listener);
    }

    private async updateDevices() {
        if (!this.controller) {
            return;
        }
        try {
            await this.controller.updateAllDeviceData();
        } catch (error) {
            this.log.error(`[API Syncing] Failed to update devices data: ${JSON.stringify(error)}`);
        }
    }

    forceUpdateDevices(delay: number = Math.max(0, this.config.forceUpdateDelay || DEFAULT_FORCE_UPDATE_DELAY_MS)) {
        // Debounce: if a force update is already pending, don't restart timers
        if (this.forceUpdateTimeout) {
            this.log.debug('[API Syncing] Force update already pending, skipping duplicate request');
            return;
        }

        this.log.debug(`[API Syncing] Force update devices data (delayed by ${delay}ms)`);

        clearInterval(this.updateInterval);

        this.forceUpdateTimeout = setTimeout(async () => {
            this.forceUpdateTimeout = undefined;
            try {
                await this.updateDevices();
            } catch (error) {
                this.log.error(`[API Syncing] Force update failed: ${(error as Error).message}`);
            }
            this.startUpdateDevicesInterval();
        }, delay);
    }

    private startUpdateDevicesInterval() {
        this.log.debug(`[API Syncing] (Re)starting update devices interval every ${this.updateIntervalDelay / ONE_MINUTE_MS} minutes`);
        this.updateInterval = setInterval(async () => {
            try {
                await this.updateDevices();
            } catch (error) {
                this.log.error(`[API Syncing] Periodic update failed: ${(error as Error).message}`);
            }
        }, this.updateIntervalDelay);
    }

    private async enableWebSocket() {
        if (!this.controller) {
            return;
        }

        try {
            this.log.info('[WebSocket] Enabling real-time updates...');
            await this.controller.enableWebSocket();
        } catch (error) {
            this.log.warn(`[WebSocket] Failed to enable: ${(error as Error).message}`);
            this.log.warn('[WebSocket] Falling back to polling-only mode');
        }
    }

    private isExcludedDevice(excludedDevicesByDeviceId: Array<string>, deviceId: string): boolean {
        return typeof excludedDevicesByDeviceId !== 'undefined' && excludedDevicesByDeviceId.includes(deviceId);
    }

    private getPrivacyFriendlyConfig(config: PlatformConfig): object {
        return {
            ...config,
            clientId: StringUtils.mask(config.clientId),
            clientSecret: StringUtils.mask(config.clientSecret),
            daikinEmail: StringUtils.mask(config.daikinEmail),
            daikinPassword: config.daikinPassword ? '***' : undefined,
            excludedDevicesByDeviceId: config.excludedDevicesByDeviceId ? config.excludedDevicesByDeviceId.map((deviceId: string) => StringUtils.mask(deviceId)) : [],
        };
    }

    private onInvalidGrantError(tokenFilePath: string) {
        this.log.warn('[API Syncing] TokenSet is invalid, removing TokenSet file');
        try {
            fs.unlinkSync(tokenFilePath);
            this.log.warn('[API Syncing] TokenSet file removed. Please re-authenticate via the Homebridge UI.');
        } catch (e) {
            this.log.error('[API Syncing] TokenSet file could not be removed. Location:', tokenFilePath, e);
        }
    }

    /**
     * Handle WebSocket device updates by pushing updated values to HomeKit
     */
    private handleWebSocketDeviceUpdate(update: {
        deviceId: string;
        embeddedId: string;
        characteristicName: string;
        data: { value: unknown };
    }): void {
        // Find the accessory for this device
        const accessory = this.accessories.find(
            a => a.context.device.getId() === update.deviceId,
        );

        if (!accessory) {
            this.log.debug(`[WebSocket] No accessory found for device ${update.deviceId}`);
            return;
        }

        // Use the UpdateMapper to apply the update
        const result = this.updateMapper.applyUpdate(accessory, update);

        if (result.success) {
            this.log.debug(`[WebSocket] Updated ${result.updated.join(', ')}`);
        }
    }
}
