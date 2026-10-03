/**
 * Daikin Cloud API Types
 */

import type { z } from 'zod';
import type { GatewayDeviceSchema, TokenSetSchema } from './daikin-schemas';

// OIDC Configuration (Developer Portal)
export const DAIKIN_OIDC_CONFIG = {
  authorizationEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/authorize',
  tokenEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/token',
  revokeEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/revoke',
  apiBaseUrl: 'https://api.onecta.daikineurope.com',
  scope: 'openid onecta:basic.integration',
};

// Mobile App OIDC Configuration (Gigya + PKCE)
// Note: These credentials can be overridden via environment variables for security
export const DAIKIN_MOBILE_CONFIG = {
  apiKey: process.env.DAIKIN_API_KEY || '3_xRB3jaQ62bVjqXU1omaEsPDVYC0Twi1zfq1zHPu_5HFT0zWkDvZJS97Yw1loJnTm',
  clientId: process.env.DAIKIN_CLIENT_ID || 'FjS6T5oZHvzpZENIDybFRdtK',
  clientSecret: process.env.DAIKIN_CLIENT_SECRET || '_yWGLBGUnQFrN-u7uIOAZhSBsJOfcnBs0IS87wTgUvUmnLnEOs4NQmaKagqZBpQpG0XYl07KeCx8XHHKxAn24w',
  redirectUri: process.env.DAIKIN_REDIRECT_URI || 'daikinunified://cdc/',
  gigyaBaseUrl: process.env.DAIKIN_GIGYA_BASE_URL || 'https://cdc.daikin.eu',
  idpTokenEndpoint: process.env.DAIKIN_IDP_TOKEN_ENDPOINT || 'https://idp.onecta.daikineurope.com/v1/oidc/token',
  scope: process.env.DAIKIN_SCOPE || 'openid onecta:onecta.application offline_access',
  apiBaseUrl: process.env.DAIKIN_API_BASE_URL || 'https://api.onecta.daikineurope.com',
  websocketUrl: process.env.DAIKIN_WEBSOCKET_URL || 'wss://wsapi.onecta.daikineurope.com',
};

// Token Set (derived from the runtime schema so the two cannot drift)
export type TokenSet = z.infer<typeof TokenSetSchema>;

// Rate Limit Status
export interface RateLimitStatus {
    limitMinute?: number;
    remainingMinute?: number;
    limitDay?: number;
    remainingDay?: number;
}

// Device Management Point
export interface ManagementPoint {
    embeddedId: string;
    managementPointType: string;
    name?: { value: string };
    modelInfo?: { value: string };
    onOffMode?: { value: string };
    operationMode?: { value: string; values?: string[] };
    temperatureControl?: {
        value: {
            operationModes: {
                [mode: string]: {
                    setpoints: {
                        [setpoint: string]: {
                            value: number;
                            minValue?: number;
                            maxValue?: number;
                            stepValue?: number;
                        };
                    };
                };
            };
        };
    };
    sensoryData?: {
        value: {
            roomTemperature?: { value: number; unit?: string };
            outdoorTemperature?: { value: number; unit?: string };
            leavingWaterTemperature?: { value: number; unit?: string };
        };
    };
    fanControl?: {
        value: {
            operationModes: {
                [mode: string]: {
                    fanSpeed?: { currentMode?: { value: string }; modes?: { [mode: string]: { value?: number } } };
                    fanDirection?: { horizontal?: { currentMode?: { value: string } }; vertical?: { currentMode?: { value: string } } };
                };
            };
        };
    };
    powerfulMode?: { value: string };
    econoMode?: { value: string };
    streamerMode?: { value: string };
    holidayMode?: { value: { enabled: boolean; startDate?: string; endDate?: string } };
    [key: string]: unknown;
}

// Gateway Device from API (derived from the runtime schema so the two cannot drift)
export type GatewayDevice = z.infer<typeof GatewayDeviceSchema>;

// Authentication mode
export type AuthMode = 'developer_portal' | 'mobile_app';

// Client Configuration (Developer Portal)
export interface DaikinClientConfig {
    clientId: string;
    clientSecret: string;
    callbackServerExternalAddress: string;
    callbackServerPort: number;
    oidcCallbackServerBindAddr?: string;
    tokenFilePath: string;
}

// Mobile Client Configuration
export interface MobileClientConfig {
    email: string;
    password: string;
    tokenFilePath: string;
}

// Unified Controller Configuration
export interface DaikinControllerConfig {
    authMode: AuthMode;
    tokenFilePath: string;
    // Developer Portal fields (required if authMode is 'developer_portal')
    clientId?: string;
    clientSecret?: string;
    callbackServerExternalAddress?: string;
    callbackServerPort?: number;
    oidcCallbackServerBindAddr?: string;
    // Mobile App fields (required if authMode is 'mobile_app')
    email?: string;
    password?: string;
}

// OAuth Provider Interface (for WebSocket and API)
export interface OAuthProvider {
    getAccessToken(): Promise<string>;
    isAuthenticated(): boolean;
    refreshToken(): Promise<TokenSet>;
}

// WebSocket Device Update Event Data
export interface WebSocketDeviceUpdate {
    deviceId: string;
    embeddedId: string;
    managementPointId: string;
    characteristicName: string;
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

/** Shape of RATE_LIMIT_STATUS_FILE */
export interface RateLimitStatusFile extends RateLimitStatus {
    /** Auth mode the headers were observed under */
    mode: 'developer_portal' | 'mobile_app';
    /** ISO timestamp of when the headers were observed */
    updatedAt: string;
}
