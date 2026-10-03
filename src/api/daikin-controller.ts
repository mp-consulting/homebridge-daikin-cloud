/**
 * Daikin Cloud Controller
 *
 * Main controller that ties together OAuth, API, WebSocket, and device management.
 * Supports both Developer Portal and Mobile App authentication methods.
 */

import { EventEmitter } from 'node:events';
import type {
  DaikinClientConfig,
  DaikinControllerConfig,
  MobileClientConfig,
  OAuthProvider,
  TokenSet,
  WebSocketDeviceUpdate,
} from './daikin-types';
import { DEFAULT_CALLBACK_PORT } from '../constants';
import { DaikinOAuth } from './daikin-oauth';
import { DaikinMobileOAuth } from './daikin-mobile-oauth';
import { DaikinApi } from './daikin-api';
import { DaikinCloudDevice } from './daikin-device';
import { DaikinWebSocket } from './daikin-websocket';

export class DaikinCloudController extends EventEmitter {
  private readonly oauth: OAuthProvider;
  private readonly mobileOAuth?: DaikinMobileOAuth;
  private readonly api: DaikinApi;
  private readonly websocket: DaikinWebSocket;
  private readonly authMode: 'developer_portal' | 'mobile_app';
  private devices: DaikinCloudDevice[] = [];

  constructor(config: DaikinControllerConfig | DaikinClientConfig) {
    super();

    // Determine auth mode (default to developer_portal for backwards compatibility)
    this.authMode = ('authMode' in config && config.authMode === 'mobile_app') ? 'mobile_app' : 'developer_portal';

    if (this.authMode === 'mobile_app') {
      // Mobile App authentication
      const mobileConfig: MobileClientConfig = {
        email: (config as DaikinControllerConfig).email!,
        password: (config as DaikinControllerConfig).password!,
        tokenFilePath: config.tokenFilePath,
      };

      this.mobileOAuth = new DaikinMobileOAuth(
        mobileConfig,
        (tokenSet) => this.emit('token_update', tokenSet),
        (error) => this.emit('error', error.message),
        (message) => this.emit('log', message),
      );
      this.oauth = this.mobileOAuth;
    } else {
      // Developer Portal authentication
      const devConfig: DaikinClientConfig = {
        clientId: (config as DaikinClientConfig).clientId,
        clientSecret: (config as DaikinClientConfig).clientSecret,
        callbackServerExternalAddress: (config as DaikinClientConfig).callbackServerExternalAddress,
        callbackServerPort: (config as DaikinClientConfig).callbackServerPort || DEFAULT_CALLBACK_PORT,
        oidcCallbackServerBindAddr: (config as DaikinClientConfig).oidcCallbackServerBindAddr,
        tokenFilePath: config.tokenFilePath,
      };

      this.oauth = new DaikinOAuth(
        devConfig,
        (tokenSet) => this.emit('token_update', tokenSet),
        (error) => this.emit('error', error.message),
      );
    }

    this.api = new DaikinApi(
      this.oauth,
      (status) => this.emit('rate_limit_status', status),
    );

    // Errors are forwarded once, via the 'error' listener in setupWebSocketHandlers
    this.websocket = new DaikinWebSocket(this.oauth);

    this.setupWebSocketHandlers();
  }

  /**
     * Authenticate with mobile app credentials (only for mobile_app mode)
     * Must be called before using the API when using mobile_app mode without existing tokens.
     */
  async authenticateMobile(): Promise<TokenSet> {
    if (this.authMode !== 'mobile_app' || !this.mobileOAuth) {
      throw new Error('Mobile authentication is only available in mobile_app mode');
    }
    return this.mobileOAuth.authenticate();
  }

  /**
     * Set up WebSocket event handlers
     */
  private setupWebSocketHandlers(): void {
    this.websocket.on('connected', () => {
      this.emit('websocket_connected');
    });

    this.websocket.on('disconnected', (info?: { code: number; reason: string; reconnecting: boolean }) => {
      this.emit('websocket_disconnected', info);
    });

    this.websocket.on('device_update', (update: WebSocketDeviceUpdate) => {
      this.handleWebSocketDeviceUpdate(update);
    });

    this.websocket.on('error', (error: Error) => {
      this.emit('error', `WebSocket error: ${error.message}`);
    });
  }

  /**
     * Handle device updates from WebSocket
     */
  private handleWebSocketDeviceUpdate(update: WebSocketDeviceUpdate): void {
    const device = this.devices.find(d => d.getId() === update.deviceId);
    if (device) {
      // Apply the update to the device's raw data
      device.applyWebSocketUpdate(update);
      device.updateTimestamp();

      // Emit event for listeners (e.g., accessories)
      this.emit('websocket_device_update', update);
    }
  }

  /**
     * Check if authenticated
     */
  isAuthenticated(): boolean {
    return this.oauth.isAuthenticated();
  }

  /**
     * Get all cloud devices (initial discovery: transient gateway errors are retried)
     */
  async getCloudDevices(): Promise<DaikinCloudDevice[]> {
    return this.fetchDevices(true);
  }

  /**
     * Update all device data from the cloud (periodic polling: no gateway-error
     * retries, the next poll is the retry)
     */
  async updateAllDeviceData(): Promise<void> {
    await this.fetchDevices(false);
  }

  private async fetchDevices(retryGatewayErrors: boolean): Promise<DaikinCloudDevice[]> {
    if (!this.oauth.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    const rawDevices = await this.api.getDevices({ retryGatewayErrors });

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

  // =========================================================================
  // WebSocket methods
  // =========================================================================

  /**
     * Enable and connect WebSocket for real-time updates
     */
  async enableWebSocket(): Promise<void> {
    if (!this.oauth.isAuthenticated()) {
      throw new Error('Cannot enable WebSocket: not authenticated');
    }

    await this.websocket.connect();
  }

  /**
     * Disable and disconnect WebSocket
     */
  disableWebSocket(): void {
    this.websocket.disconnect();
  }

  /**
     * Check if WebSocket is connected
     */
  isWebSocketConnected(): boolean {
    return this.websocket.isConnected();
  }

}
