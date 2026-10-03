/**
 * Daikin WebSocket Client
 *
 * Handles real-time updates from the Daikin Cloud via WebSocket.
 * Provides push notifications for device state changes without polling.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { OAuthProvider } from './daikin-types';
import { DAIKIN_WEBSOCKET_URL } from '../constants';
import { withHttpDefaults } from './http-defaults';
import { toMessage } from '../utils/errors';

// Reconnection settings
const INITIAL_RECONNECT_DELAY = 1000;  // 1 second
const MAX_RECONNECT_DELAY = 300000;    // 5 minutes
const RECONNECT_BACKOFF_MULTIPLIER = 2;
const MAX_RECONNECT_ATTEMPTS = 50;     // Give up after 50 consecutive failures
const RECONNECT_JITTER_RATIO = 0.25;   // ±25% randomisation so many clients don't reconnect in lockstep
// A connection must stay open this long before the backoff is reset; a server that accepts
// and immediately drops the socket must not cause a tight reconnect loop.
const STABLE_CONNECTION_MS = 60000;

// Heartbeat settings
const PING_INTERVAL = 30000;  // 30 seconds
const PONG_TIMEOUT = 10000;   // 10 seconds to receive pong

// Connection timeout
const CONNECTION_TIMEOUT = 30000;  // 30 seconds to establish connection

/**
 * WebSocket event for a gateway device management point characteristic update
 */
export interface GatewayCharacteristicEvent {
    event: 'gateway:managementpoint:characteristic';
    eventType: 'update';
    embeddedId: string;
    managementPointId: string;
    gatewayDeviceId: string;
    type: string;
    data: {
        name: string;
        settable?: boolean;
        value: unknown;
        values?: string[];
        ref?: string;
        minValue?: number;
        maxValue?: number;
        stepValue?: number;
    };
}

/**
 * WebSocket event for a group characteristic update
 */
export interface GroupCharacteristicEvent {
    event: 'group:characteristic';
    eventType: 'update';
    groupId: string;
    siteId: string;
    data: {
        name: string;
        settable?: boolean;
        value: unknown;
        values?: string[];
        ref?: string;
        minValue?: number;
        maxValue?: number;
        stepValue?: number;
    };
}

/**
 * WebSocket connection state
 */
export type WebSocketState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * DaikinWebSocket class
 *
 * Events emitted:
 * - 'device_update': Emitted when a device characteristic is updated
 * - 'connected': Emitted when WebSocket connection is established
 * - 'disconnected': Emitted when WebSocket connection is closed
 * - 'error': Emitted on WebSocket errors
 */
export class DaikinWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private state: WebSocketState = 'disconnected';
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private shouldReconnect = true;
  private connectionAttempts = 0;
  private stableConnectionTimeout: NodeJS.Timeout | null = null;

  constructor(
        private readonly oauth: OAuthProvider,
        private readonly onError?: (error: Error) => void,
  ) {
    super();
  }

  /**
     * Get current connection state
     */
  getState(): WebSocketState {
    return this.state;
  }

  /**
     * Check if WebSocket is connected
     */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
     * Connect to the WebSocket server
     */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.shouldReconnect = true;
    await this.establishConnection();
  }

  /**
     * Disconnect from the WebSocket server
     */
  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();
    this.state = 'disconnected';
    this.emit('disconnected');
  }

  /**
     * Establish the WebSocket connection
     */
  private async establishConnection(): Promise<void> {
    this.state = 'connecting';
    this.connectionAttempts++;

    try {
      const accessToken = await this.oauth.getAccessToken();

      this.ws = new WebSocket(DAIKIN_WEBSOCKET_URL, withHttpDefaults({
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        handshakeTimeout: CONNECTION_TIMEOUT,
      }));

      this.setupEventHandlers();
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(toMessage(error)));
      this.scheduleReconnect();
    }
  }

  /**
     * Set up WebSocket event handlers
     */
  private setupEventHandlers(): void {
    if (!this.ws) {
      return;
    }

    this.ws.on('open', () => {
      this.state = 'connected';
      this.clearStableConnectionTimeout();
      this.stableConnectionTimeout = setTimeout(() => {
        this.stableConnectionTimeout = null;
        this.reconnectDelay = INITIAL_RECONNECT_DELAY;
        this.connectionAttempts = 0;
      }, STABLE_CONNECTION_MS);
      this.startHeartbeat();
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.handleClose(code, reason.toString());
    });

    this.ws.on('error', (error: Error) => {
      this.handleError(error);
    });

    this.ws.on('pong', () => {
      this.clearPongTimeout();
    });
  }

  /**
     * Handle incoming WebSocket messages. Anything that is not valid JSON or does
     * not have the minimal expected shape is ignored.
     */
  private handleMessage(data: WebSocket.Data): void {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!isRecord(message) || !isRecord(message.data) || typeof message.data.name !== 'string') {
      return;
    }

    if (message.event === 'gateway:managementpoint:characteristic') {
      if (typeof message.gatewayDeviceId !== 'string' || typeof message.embeddedId !== 'string') {
        return;
      }
      const event = message as unknown as GatewayCharacteristicEvent;
      this.emit('device_update', {
        deviceId: event.gatewayDeviceId,
        embeddedId: event.embeddedId,
        managementPointId: event.managementPointId,
        characteristicName: event.data.name,
        data: event.data,
      });
    } else if (message.event === 'group:characteristic') {
      const event = message as unknown as GroupCharacteristicEvent;
      this.emit('group_update', {
        groupId: event.groupId,
        siteId: event.siteId,
        characteristicName: event.data.name,
        data: event.data,
      });
    }
  }

  /**
     * Handle WebSocket close event
     */
  private handleClose(code: number, reason: string): void {
    this.cleanup();

    if (this.shouldReconnect) {
      this.state = 'reconnecting';
      this.emit('disconnected', { code, reason, reconnecting: true });
      this.scheduleReconnect();
    } else {
      this.state = 'disconnected';
      this.emit('disconnected', { code, reason, reconnecting: false });
    }
  }

  /**
     * Handle WebSocket errors
     */
  private handleError(error: Error): void {
    if (this.onError) {
      this.onError(error);
    }
    this.emit('error', error);
  }

  /**
     * Schedule a reconnection attempt with exponential backoff
     */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    // Circuit breaker: give up after too many consecutive failures
    if (this.connectionAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.state = 'disconnected';
      const error = new Error(`WebSocket gave up after ${MAX_RECONNECT_ATTEMPTS} consecutive reconnection attempts`);
      this.handleError(error);
      this.emit('disconnected', { reconnecting: false });
      return;
    }

    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER_RATIO;
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.establishConnection();
      } catch (error) {
        this.handleError(error instanceof Error ? error : new Error(toMessage(error)));
        this.scheduleReconnect();
      }
    }, Math.round(this.reconnectDelay * jitter));

    // Exponential backoff with max delay
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
      MAX_RECONNECT_DELAY,
    );
  }

  /**
     * Start heartbeat to keep connection alive
     */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.setPongTimeout();
      }
    }, PING_INTERVAL);
  }

  /**
     * Stop heartbeat
     */
  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.clearPongTimeout();
  }

  /**
     * Set pong timeout
     */
  private setPongTimeout(): void {
    this.clearPongTimeout();
    this.pongTimeout = setTimeout(() => {
      // Connection seems dead, force reconnect
      if (this.ws) {
        this.ws.terminate();
      }
    }, PONG_TIMEOUT);
  }

  /**
     * Clear pong timeout
     */
  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private clearStableConnectionTimeout(): void {
    if (this.stableConnectionTimeout) {
      clearTimeout(this.stableConnectionTimeout);
      this.stableConnectionTimeout = null;
    }
  }

  /**
     * Clean up resources
     */
  private cleanup(): void {
    this.stopHeartbeat();
    this.clearStableConnectionTimeout();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      // Closing a CONNECTING socket aborts the handshake and emits 'error' asynchronously;
      // without a listener that would be an uncaught exception.
      this.ws.on('error', () => {});
      if (this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.terminate();
      } else if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
