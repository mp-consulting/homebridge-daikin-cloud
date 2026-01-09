/**
 * Daikin Cloud API Types
 */

// OIDC Configuration
export const DAIKIN_OIDC_CONFIG = {
    authorizationEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/authorize',
    tokenEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/token',
    revokeEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/revoke',
    apiBaseUrl: 'https://api.onecta.daikineurope.com',
    scope: 'openid onecta:basic.integration',
};

// Token Set
export interface TokenSet {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in?: number;
    expires_at?: number;
    scope?: string;
}

// Rate Limit Status
export interface RateLimitStatus {
    limitMinute?: number;
    remainingMinute?: number;
    limitDay?: number;
    remainingDay?: number;
}

// API Response with Rate Limit
export interface ApiResponse<T> {
    data: T;
    rateLimit: RateLimitStatus;
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
    holidayMode?: { value: string };
    [key: string]: unknown;
}

// Gateway Device from API
export interface GatewayDevice {
    id: string;
    deviceModel?: string;
    type?: string;
    isCloudConnectionUp?: { value: boolean };
    managementPoints: ManagementPoint[];
    [key: string]: unknown;
}

// Client Configuration
export interface DaikinClientConfig {
    clientId: string;
    clientSecret: string;
    callbackServerExternalAddress: string;
    callbackServerPort: number;
    oidcCallbackServerBindAddr?: string;
    tokenFilePath: string;
}

// Event Types
export type DaikinEventType =
    | 'token_update'
    | 'rate_limit_status'
    | 'error';
