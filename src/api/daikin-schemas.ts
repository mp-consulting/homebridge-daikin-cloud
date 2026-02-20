/**
 * Zod validation schemas for Daikin Cloud API responses
 * Provides runtime type validation and better error handling
 */

import { z } from 'zod';

// Token Set Schema
export const TokenSetSchema = z.object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
    token_type: z.string(),
    expires_in: z.number().optional(),
    expires_at: z.number().optional(),
    scope: z.string().optional(),
});

// Management Point Schema
export const ManagementPointSchema = z.object({
    embeddedId: z.string(),
    managementPointType: z.string(),
    name: z.object({ value: z.string() }).optional(),
    modelInfo: z.object({ value: z.string() }).optional(),
    onOffMode: z.object({ value: z.string() }).optional(),
    operationMode: z.object({
        value: z.string(),
        values: z.array(z.string()).optional(),
    }).optional(),
    temperatureControl: z.object({
        value: z.object({
            operationModes: z.record(z.object({
                setpoints: z.record(z.object({
                    value: z.number(),
                    minValue: z.number().optional(),
                    maxValue: z.number().optional(),
                    stepValue: z.number().optional(),
                })),
            })),
        }),
    }).optional(),
    sensoryData: z.object({
        value: z.object({
            roomTemperature: z.object({
                value: z.number(),
                unit: z.string().optional(),
            }).optional(),
            outdoorTemperature: z.object({
                value: z.number(),
                unit: z.string().optional(),
            }).optional(),
            leavingWaterTemperature: z.object({
                value: z.number(),
                unit: z.string().optional(),
            }).optional(),
        }),
    }).optional(),
    fanControl: z.object({
        value: z.object({
            operationModes: z.record(z.object({
                fanSpeed: z.object({
                    currentMode: z.object({ value: z.string() }).optional(),
                    modes: z.record(z.object({ value: z.number().optional() })).optional(),
                }).optional(),
                fanDirection: z.object({
                    horizontal: z.object({ currentMode: z.object({ value: z.string() }).optional() }).optional(),
                    vertical: z.object({ currentMode: z.object({ value: z.string() }).optional() }).optional(),
                }).optional(),
            })),
        }),
    }).optional(),
    powerfulMode: z.object({ value: z.string() }).optional(),
    econoMode: z.object({ value: z.string() }).optional(),
    streamerMode: z.object({ value: z.string() }).optional(),
    holidayMode: z.object({ value: z.string() }).optional(),
}).passthrough(); // Allow additional properties

// Gateway Device Schema
export const GatewayDeviceSchema = z.object({
    id: z.string(),
    deviceModel: z.string().optional(),
    type: z.string().optional(),
    isCloudConnectionUp: z.object({ value: z.boolean() }).optional(),
    managementPoints: z.array(ManagementPointSchema),
}).passthrough(); // Allow additional properties

// Configuration Validation Schema
export const DaikinControllerConfigSchema = z.object({
    authMode: z.enum(['developer_portal', 'mobile_app']),
    tokenFilePath: z.string().min(1),
    // Developer Portal fields
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    callbackServerExternalAddress: z.string().optional(),
    callbackServerPort: z.number().int().min(1).max(65535).optional(),
    oidcCallbackServerBindAddr: z.string().optional(),
    // Mobile App fields
    email: z.string().email().optional(),
    password: z.string().optional(),
}).refine(
    (data) => {
        if (data.authMode === 'developer_portal') {
            return !!(data.clientId && data.clientSecret && data.callbackServerExternalAddress && data.callbackServerPort);
        }
        if (data.authMode === 'mobile_app') {
            return !!(data.email && data.password);
        }
        return false;
    },
    {
        message: 'Missing required configuration for the selected authentication mode',
    },
);

// Helper function to validate and parse data
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown, context?: string): T {
    try {
        return schema.parse(data);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
            throw new Error(`Validation failed${context ? ` for ${context}` : ''}: ${errorMessages}`);
        }
        throw error;
    }
}

// Helper function to safely validate without throwing
export function safeValidateData<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
    const result = schema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    const errorMessages = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
    return { success: false, error: errorMessages };
}
