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
import { DaikinOAuth } from './daikin-oauth';
import { DaikinMobileOAuth } from './daikin-mobile-oauth';
import { DaikinApi } from './daikin-api';
import { DaikinCloudDevice } from './daikin-device';
import type { WebSocketState } from './daikin-websocket';
import { DaikinWebSocket } from './daikin-websocket';

export class DaikinCloudController extends EventEmitter {
  private readonly oauth: OAuthProvider & { getTokenSet(): TokenSet | null; getTokenExpiration(): Date | null };
  private readonly mobileOAuth?: DaikinMobileOAuth;
  private readonly devPortalOAuth?: DaikinOAuth;
  private readonly api: DaikinApi;
  private readonly websocket: DaikinWebSocket;
  private readonly authMode: 'developer_portal' | 'mobile_app';
  private devices: DaikinCloudDevice[] = [];
  private websocketEnabled = false;

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
      );
      this.oauth = this.mobileOAuth;
    } else {
      // Developer Portal authentication
      const devConfig: DaikinClientConfig = {
        clientId: (config as DaikinClientConfig).clientId,
        clientSecret: (config as DaikinClientConfig).clientSecret,
        callbackServerExternalAddress: (config as DaikinClientConfig).callbackServerExternalAddress,
        callbackServerPort: (config as DaikinClientConfig).callbackServerPort || 8582,
        oidcCallbackServerBindAddr: (config as DaikinClientConfig).oidcCallbackServerBindAddr,
        tokenFilePath: config.tokenFilePath,
      };

      this.devPortalOAuth = new DaikinOAuth(
        devConfig,
        (tokenSet) => this.emit('token_update', tokenSet),
        (error) => this.emit('error', error.message),
      );
      this.oauth = this.devPortalOAuth;
    }

    this.api = new DaikinApi(
      this.oauth,
      (status) => this.emit('rate_limit_status', status),
    );

    this.websocket = new DaikinWebSocket(
      this.oauth,
      (error) => this.emit('error', `WebSocket: ${error.message}`),
    );

    this.setupWebSocketHandlers();
  }

  /**
     * Get the authentication mode
     */
  getAuthMode(): 'developer_portal' | 'mobile_app' {
    return this.authMode;
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
     * Build authorization URL (Developer Portal mode only)
     */
  buildAuthUrl(state?: string): { url: string; state: string } {
    if (!this.devPortalOAuth) {
      throw new Error('buildAuthUrl is only available in developer_portal mode');
    }
    return this.devPortalOAuth.buildAuthUrl(state);
  }

  /**
     * Exchange authorization code for tokens (Developer Portal mode only)
     */
  async exchangeCode(code: string): Promise<TokenSet> {
    if (!this.devPortalOAuth) {
      throw new Error('exchangeCode is only available in developer_portal mode');
    }
    return this.devPortalOAuth.exchangeCode(code);
  }

  /**
     * Revoke authentication
     */
  async revokeAuth(): Promise<void> {
    if (this.devPortalOAuth) {
      return this.devPortalOAuth.revokeToken();
    } else if (this.mobileOAuth) {
      this.mobileOAuth.clearTokens();
    }
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

    this.websocketEnabled = true;
    await this.websocket.connect();
  }

  /**
     * Disable and disconnect WebSocket
     */
  disableWebSocket(): void {
    this.websocketEnabled = false;
    this.websocket.disconnect();
  }

  /**
     * Check if WebSocket is enabled
     */
  isWebSocketEnabled(): boolean {
    return this.websocketEnabled;
  }

  /**
     * Check if WebSocket is connected
     */
  isWebSocketConnected(): boolean {
    return this.websocket.isConnected();
  }

  /**
     * Get WebSocket connection state
     */
  getWebSocketState(): WebSocketState {
    return this.websocket.getState();
  }
}
