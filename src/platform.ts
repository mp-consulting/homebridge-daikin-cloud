import type { API, Characteristic, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { AccessoryFactory } from './device';

import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { StringUtils } from './utils/strings';
import { toMessage } from './utils/errors';

import fs from 'node:fs';
import type { DaikinCloudDevice, RateLimitStatus, RateLimitStatusFile } from './api';
import { DaikinCloudRepo, DaikinCloudController } from './api';
import { configureHttpTransport, getHttpTransportMode } from './api/http-transport';
import type { PluginConfig } from './config/config-manager';
import { ConfigManager } from './config/config-manager';
import {
  ONE_SECOND_MS,
  ONE_MINUTE_MS,
  RATE_LIMIT_WARNING_THRESHOLD,
  RATE_LIMIT_STATUS_FILE,
  TOKEN_FILES,
} from './constants';

/** Safety-net poll interval while the WebSocket is delivering push updates */
export const WEBSOCKET_SAFETY_POLL_INTERVAL_MS = 60 * ONE_MINUTE_MS;
/** Minimum poll interval once the daily quota is nearly exhausted */
export const LOW_QUOTA_POLL_INTERVAL_MS = 60 * ONE_MINUTE_MS;
/** Upper bound of the failure backoff, as a multiple of the base interval */
export const MAX_POLL_BACKOFF_MULTIPLIER = 4;
/** Minimum time between two writes of the rate-limit status file */
const RATE_LIMIT_FILE_MIN_WRITE_INTERVAL_MS = 5 * ONE_SECOND_MS;

export interface PollIntervalInput {
  configuredMs: number;
  webSocketConnected: boolean;
  consecutiveFailures: number;
  remainingDay?: number;
}

/**
 * Compute the delay until the next periodic poll:
 * - WebSocket connected: push updates arrive anyway, poll only as a safety net
 * - consecutive failures: exponential backoff, capped at MAX_POLL_BACKOFF_MULTIPLIER
 * - daily quota nearly exhausted: stretch to LOW_QUOTA_POLL_INTERVAL_MS
 */
export function computePollInterval(input: PollIntervalInput): number {
  let interval = input.configuredMs;
  if (input.webSocketConnected) {
    interval = Math.max(interval, WEBSOCKET_SAFETY_POLL_INTERVAL_MS);
  }
  if (input.consecutiveFailures > 0) {
    interval *= Math.min(2 ** input.consecutiveFailures, MAX_POLL_BACKOFF_MULTIPLIER);
  }
  if (input.remainingDay !== undefined && input.remainingDay <= RATE_LIMIT_WARNING_THRESHOLD) {
    interval = Math.max(interval, LOW_QUOTA_POLL_INTERVAL_MS);
  }
  return interval;
}

/**
 * Wrap an expensive serialisation so it only runs if the logger actually
 * formats the parameter (Homebridge skips formatting when debug is off).
 */
function lazyJson(producer: () => unknown, space?: number): object {
  return { [inspect.custom]: () => JSON.stringify(producer(), null, space) };
}

export type DaikinCloudAccessoryContext = {
    device: DaikinCloudDevice;
};

export class DaikinCloudPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory<DaikinCloudAccessoryContext>[] = [];

  public readonly storagePath: string = '';
  /** Single source of truth for the plugin configuration: read config only through this */
  public readonly configManager: ConfigManager;
  public controller: DaikinCloudController | undefined;

  public readonly updateIntervalDelay: number;
  private pollTimer: NodeJS.Timeout | undefined;
  private forceUpdateTimeout: NodeJS.Timeout | undefined;
  private inFlightUpdate: Promise<void> | undefined;
  private pollingStarted = false;
  private isShuttingDown = false;
  private consecutivePollFailures = 0;
  private remainingDay: number | undefined;
  private webSocketHasConnected = false;
  private pendingRateLimitStatus: RateLimitStatusFile | undefined;
  private rateLimitWriteTimer: NodeJS.Timeout | undefined;
  private lastRateLimitWriteAt = 0;
  private readonly accessoryFactory: AccessoryFactory;
  private readonly authMode: 'developer_portal' | 'mobile_app';
  private readonly deviceListeners = new Map<string, () => void>();

  constructor(
        public readonly log: Logger,
        config: PlatformConfig,
        public readonly api: API,
  ) {
    this.configManager = new ConfigManager(config as PluginConfig);
    const configManager = this.configManager;

    this.log.info('--- Daikin info for debugging reasons (enable Debug Mode for more logs) ---');

    this.log.debug('[Platform] Initializing platform:', configManager.getName());

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.storagePath = api.user.storagePath();
    this.updateIntervalDelay = configManager.getUpdateIntervalMs();
    this.accessoryFactory = new AccessoryFactory(this);

    // Determine authentication mode
    this.authMode = configManager.getAuthMode();
    this.log.info(`[Config] Authentication mode: ${this.authMode}`);

    // Select the HTTP transport (env var DAIKIN_HTTP_TRANSPORT wins over config)
    configureHttpTransport(configManager.getHttpTransport());
    if (getHttpTransportMode() === 'curl') {
      this.log.info('[Config] HTTP transport: curl subprocess (WAF fingerprint workaround). '
        + 'Note: WebSocket connections still use Node TLS — disable WebSocket if it cannot connect.');
    }

    // Validate configuration
    const validation = configManager.validate();
    for (const warning of validation.warnings) {
      this.log.warn(`[Config] ${warning}`);
    }

    // Check if credentials are configured based on auth mode
    if (this.authMode === 'mobile_app') {
      const mobileCredentials = configManager.getMobileCredentials();
      if (!mobileCredentials) {
        this.log.warn('[Config] Daikin email and/or password not configured.');
        this.log.warn('[Config] Mobile App mode expects the config keys "daikinEmail" and "daikinPassword".');
        this.log.warn('[Config] Please configure the plugin using the Homebridge UI.');
        this.log.info('--------------- End Daikin info for debugging reasons --------------------');
        return;
      }
    } else {
      if (!configManager.hasDeveloperCredentials()) {
        this.log.warn('[Config] Client ID and/or Client Secret not configured.');
        this.log.warn('[Config] Please configure the plugin using the Homebridge UI.');
        this.log.info('--------------- End Daikin info for debugging reasons --------------------');
        return;
      }
    }

    // Credentials are present: the remaining errors (e.g. a localhost callback
    // address or an invalid port) do not stop startup, but must be visible.
    for (const error of validation.errors) {
      this.log.error(`[Config] ${error}`);
    }

    // Use different token file for mobile auth to avoid conflicts
    const tokenFilePath = resolve(this.storagePath, TOKEN_FILES[this.authMode]);

    const daikinCloudControllerConfig = configManager.getControllerConfig(tokenFilePath);

    this.log.debug('[Config] Homebridge config', configManager.getRedactedConfig());

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

      // Register listeners before authenticating: an 'error' emitted without a
      // listener would throw.
      this.registerControllerListeners(this.controller);

      // Handle authentication based on mode
      if (!this.controller.isAuthenticated()) {
        if (this.authMode === 'mobile_app') {
          // For mobile auth, automatically authenticate using stored credentials
          this.log.info('[Auth] Authenticating with Daikin Cloud using mobile app credentials...');
          try {
            await this.controller.authenticateMobile();
            this.log.info('[Auth] Authentication successful!');
          } catch (error) {
            this.log.error(`[Auth] Authentication failed: ${toMessage(error)}`);
            this.log.info('--------------- End Daikin info for debugging reasons --------------------');
            return;
          }
        } else {
          this.log.warn('[Auth] Not authenticated. Please use the Homebridge UI to authenticate with Daikin Cloud.');
          this.log.info('--------------- End Daikin info for debugging reasons --------------------');
          return;
        }
      }

      const onInvalidGrantError = () => this.onInvalidGrantError(tokenFilePath);
      const devices: DaikinCloudDevice[] = await this.discoverDevices(this.controller, onInvalidGrantError);

      if (devices.length > 0 && !this.isShuttingDown) {
        this.createDevices(devices);
        this.pollingStarted = true;
        this.startUpdateDevicesInterval();

        // Enable WebSocket for real-time updates (unless explicitly disabled)
        if (this.configManager.isWebSocketEnabled()) {
          await this.enableWebSocket();
        }
      }

      this.log.info('--------------- End Daikin info for debugging reasons --------------------');
    });

    // Shutdown handler: clean up timers, WebSocket, and device listeners on platform shutdown
    this.api.on('shutdown', () => {
      this.log.debug('[Platform] Shutting down, cleaning up resources...');
      this.isShuttingDown = true;
      this.stopPolling();
      clearTimeout(this.forceUpdateTimeout);
      this.forceUpdateTimeout = undefined;
      clearTimeout(this.rateLimitWriteTimer);
      this.rateLimitWriteTimer = undefined;
      this.flushRateLimitStatus();
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

  private registerControllerListeners(controller: DaikinCloudController): void {
    controller.on('rate_limit_status', (rateLimitStatus: RateLimitStatus) => this.onRateLimitStatus(rateLimitStatus));

    controller.on('error', (error) => {
      this.log.error(`[Error] ${toMessage(error)}`);
    });

    controller.on('log', (message) => {
      this.log.info(message);
    });

    controller.on('websocket_connected', () => this.onWebSocketConnected());

    controller.on('websocket_disconnected', (info?: { reconnecting: boolean }) => {
      if (info?.reconnecting) {
        this.log.debug('[WebSocket] Disconnected, attempting to reconnect...');
      } else {
        this.log.info('[WebSocket] Disconnected');
      }
      // Push updates are gone: fall back to the configured polling interval
      if (this.pollingStarted) {
        this.startUpdateDevicesInterval();
      }
    });

    // The controller already applied the update to the device, which emits
    // 'updated' and makes the accessory refresh its characteristics.
    controller.on('websocket_device_update', (update) => {
      this.log.debug(`[WebSocket] Device update: ${update.deviceId} - ${update.characteristicName}`, lazyJson(() => update.data));
    });
  }

  public configureAccessory(accessory: PlatformAccessory) {
    this.log.info('[Platform] Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory as PlatformAccessory<DaikinCloudAccessoryContext>);
  }

  private async discoverDevices(controller: DaikinCloudController, onInvalidGrantError: () => void): Promise<DaikinCloudDevice[]> {
    try {
      return await controller.getCloudDevices();
    } catch (error) {
      if (error instanceof Error) {
        const message = `[API Syncing] Failed to get cloud devices from Daikin Cloud: ${error.message}`;
        this.log.error(message);

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
        const deviceId = device.getId();
        const uuid = this.api.hap.uuid.generate(deviceId);
        const deviceModel: string = device.getDescription().deviceModel;

        const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

        this.log.debug('Create Device', deviceModel, lazyJson(() => DaikinCloudRepo.maskSensitiveCloudDeviceData(device.desc), 4));

        if (this.configManager.isDeviceExcluded(deviceId)) {
          this.log.info(`[Platform] Device ${deviceModel} (id: ${deviceId}) is excluded, don't add accessory`);
          if (existingAccessory) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
          }
          continue;
        }

        if (existingAccessory) {
          this.log.info(`[Platform] Restoring existing accessory from cache: ${existingAccessory.displayName} (id: ${deviceId})`);

          // Remove old event listener before reassigning device
          this.removeDeviceListener(existingAccessory);

          existingAccessory.context.device = device;
          this.api.updatePlatformAccessories([existingAccessory]);

          const { profile } = this.accessoryFactory.createAccessory(existingAccessory);
          this.log.debug(`[Platform] Created ${profile.displayName} accessory`);

        } else {
          const climateControlEmbeddedId = device.desc.managementPoints.find(mp => mp.managementPointType === 'climateControl')?.embeddedId || 'climateControl';
          const nameData = device.getData(climateControlEmbeddedId, 'name', undefined).value as string | undefined;
          const displayName = StringUtils.isEmpty(nameData) ? deviceModel : nameData!;
          this.log.info(`[Platform] Adding new accessory: ${displayName} (id: ${deviceId})`);
          const accessory = new this.api.platformAccessory<DaikinCloudAccessoryContext>(displayName, uuid);
          accessory.context.device = device;

          const { profile } = this.accessoryFactory.createAccessory(accessory);
          this.log.debug(`[Platform] Created ${profile.displayName} accessory`);

          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      } catch (error) {
        if (error instanceof Error) {
          this.log.error(`[Platform] Failed to create accessory: ${error.message}`);
          this.log.debug('[Platform] Error details:', error.stack);
          this.log.debug('[Platform] Device JSON:', lazyJson(() => DaikinCloudRepo.maskSensitiveCloudDeviceData(device.desc), 2));
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

  /**
   * Fetch fresh device data. Overlapping callers (periodic poll, forced update,
   * WebSocket reconnect catch-up) share a single in-flight request.
   */
  private updateDevices(): Promise<void> {
    const controller = this.controller;
    if (!controller) {
      return Promise.resolve();
    }
    if (!this.inFlightUpdate) {
      this.inFlightUpdate = (async () => {
        try {
          await controller.updateAllDeviceData();
          this.consecutivePollFailures = 0;
        } catch (error) {
          this.consecutivePollFailures++;
          this.log.error(`[API Syncing] Failed to update devices data: ${toMessage(error)}`);
        }
      })().finally(() => {
        this.inFlightUpdate = undefined;
      });
    }
    return this.inFlightUpdate;
  }

  /**
   * Poll now, then schedule the next periodic poll.
   */
  private async pollNow(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    this.stopPolling();
    await this.updateDevices();
    this.startUpdateDevicesInterval();
  }

  forceUpdateDevices(delay: number = this.configManager.getForceUpdateDelayMs()) {
    if (this.isShuttingDown) {
      return;
    }
    // With a healthy WebSocket the change is pushed to us; a follow-up GET would only cost quota.
    if (this.isWebSocketConnected()) {
      this.log.debug('[API Syncing] WebSocket connected, skipping forced update (waiting for push update)');
      return;
    }

    // Trailing debounce: reset the timer on every change so a burst of rapid
    // SETs (e.g. toggling power, fan speed and mode in quick succession)
    // collapses into a single poll fired `delay` ms after the *last* change,
    // instead of one poll per change. This avoids redundant API calls.
    if (this.forceUpdateTimeout) {
      clearTimeout(this.forceUpdateTimeout);
      this.log.debug(`[API Syncing] Force update rescheduled (debouncing rapid changes, delayed by ${delay}ms)`);
    } else {
      this.log.debug(`[API Syncing] Force update devices data (delayed by ${delay}ms)`);
      // Pause periodic polling while we wait for the change to settle; it is
      // restarted once the debounced update fires.
      this.stopPolling();
    }

    this.forceUpdateTimeout = setTimeout(() => {
      this.forceUpdateTimeout = undefined;
      void this.pollNow();
    }, delay);
  }

  /**
   * (Re)schedule the next periodic poll. Always replaces any previously
   * scheduled poll, so there is never more than one pending.
   */
  private startUpdateDevicesInterval(): void {
    this.stopPolling();
    // Shutting down, or a pending forced update will restart polling when it fires
    if (this.isShuttingDown || this.forceUpdateTimeout) {
      return;
    }
    const delay = this.getPollInterval();
    this.log.debug(`[API Syncing] Next update of devices data in ${Math.round(delay / ONE_MINUTE_MS)} minutes`);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollNow();
    }, delay);
  }

  private stopPolling(): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private getPollInterval(): number {
    return computePollInterval({
      configuredMs: this.updateIntervalDelay,
      webSocketConnected: this.isWebSocketConnected(),
      consecutiveFailures: this.consecutivePollFailures,
      remainingDay: this.remainingDay,
    });
  }

  private isWebSocketConnected(): boolean {
    return this.controller?.isWebSocketConnected() === true;
  }

  private onWebSocketConnected(): void {
    this.log.info('[WebSocket] Connected - receiving real-time updates');
    const isReconnect = this.webSocketHasConnected;
    this.webSocketHasConnected = true;
    if (!this.pollingStarted || this.isShuttingDown) {
      return;
    }
    if (isReconnect) {
      // Catch up on anything that changed while the socket was down
      void this.pollNow();
    } else {
      // Push updates are flowing: stretch polling to the safety interval
      this.startUpdateDevicesInterval();
    }
  }

  private onRateLimitStatus(rateLimitStatus: RateLimitStatus): void {
    const { remainingDay, limitDay } = rateLimitStatus;
    if (remainingDay !== undefined) {
      this.remainingDay = remainingDay;
      if (remainingDay <= RATE_LIMIT_WARNING_THRESHOLD) {
        this.log.warn(`[Rate Limit] Rate limit almost reached, you only have ${remainingDay} calls left today`);
      }
    }
    // Only show minute limits if available (Developer Portal mode)
    const minuteInfo = rateLimitStatus.limitMinute !== undefined
      ? ` -- this minute: ${rateLimitStatus.remainingMinute}/${rateLimitStatus.limitMinute}`
      : '';
    this.log.debug(`[Rate Limit] Remaining calls today: ${remainingDay}/${limitDay}${minuteInfo}`);
    this.saveRateLimitStatus(rateLimitStatus);
  }

  /**
   * Persist the latest rate-limit headers for the settings UI (throttled,
   * best effort: failures are logged at debug level and never thrown).
   */
  private saveRateLimitStatus(rateLimitStatus: RateLimitStatus): void {
    this.pendingRateLimitStatus = {
      ...rateLimitStatus,
      mode: this.authMode,
      updatedAt: new Date().toISOString(),
    };
    if (this.rateLimitWriteTimer || this.isShuttingDown) {
      return;
    }
    const wait = Math.max(0, this.lastRateLimitWriteAt + RATE_LIMIT_FILE_MIN_WRITE_INTERVAL_MS - Date.now());
    this.rateLimitWriteTimer = setTimeout(() => {
      this.rateLimitWriteTimer = undefined;
      this.flushRateLimitStatus();
    }, wait);
  }

  private flushRateLimitStatus(): void {
    const status = this.pendingRateLimitStatus;
    if (!status) {
      return;
    }
    this.pendingRateLimitStatus = undefined;
    this.lastRateLimitWriteAt = Date.now();
    const filePath = resolve(this.storagePath, RATE_LIMIT_STATUS_FILE);
    const tmpPath = `${filePath}.tmp`;
    // Write-then-rename so the UI never reads a half-written file
    fs.promises.writeFile(tmpPath, JSON.stringify(status, null, 2))
      .then(() => fs.promises.rename(tmpPath, filePath))
      .catch((error) => {
        this.log.debug(`[Rate Limit] Could not write ${RATE_LIMIT_STATUS_FILE}: ${toMessage(error)}`);
      });
  }

  private async enableWebSocket() {
    if (!this.controller) {
      return;
    }

    try {
      this.log.info('[WebSocket] Enabling real-time updates...');
      await this.controller.enableWebSocket();
    } catch (error) {
      this.log.warn(`[WebSocket] Failed to enable: ${toMessage(error)}`);
      this.log.warn('[WebSocket] Falling back to polling-only mode');
    }
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

}
