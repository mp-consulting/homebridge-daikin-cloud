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

// Daikin "characteristic" objects always carry extra metadata Zod would
// otherwise strip: ref, settable, values, minValue/maxValue/stepValue, unit,
// maxLength… Several of these are read at runtime (e.g. setProps ranges for
// HomeKit sliders, settable checks before writes), and silent strip-out has
// caused real bugs (RotationSpeed → 400 INVALID_CHARACTERISTIC_VALUE because
// fixed.minValue/maxValue/stepValue were dropped). Wrap every inner object
// that mirrors a Daikin characteristic with .loose() so unknown keys survive.
// scripts/check-schema-drift.ts asserts this by diffing raw vs parsed.
const chr = <T extends z.ZodRawShape>(shape: T) => z.object(shape).loose();

// Management Point Schema
export const ManagementPointSchema = chr({
  embeddedId: z.string(),
  managementPointType: z.string(),
  name: chr({ value: z.string() }).optional(),
  modelInfo: chr({ value: z.string() }).optional(),
  onOffMode: chr({ value: z.string() }).optional(),
  operationMode: chr({
    value: z.string(),
    values: z.array(z.string()).optional(),
  }).optional(),
  temperatureControl: chr({
    value: chr({
      operationModes: z.record(z.string(), chr({
        setpoints: z.record(z.string(), chr({
          value: z.number(),
          minValue: z.number().optional(),
          maxValue: z.number().optional(),
          stepValue: z.number().optional(),
        })),
      })),
    }),
  }).optional(),
  sensoryData: chr({
    value: chr({
      roomTemperature: chr({
        value: z.number(),
        unit: z.string().optional(),
      }).optional(),
      outdoorTemperature: chr({
        value: z.number(),
        unit: z.string().optional(),
      }).optional(),
      leavingWaterTemperature: chr({
        value: z.number(),
        unit: z.string().optional(),
      }).optional(),
    }),
  }).optional(),
  fanControl: chr({
    value: chr({
      operationModes: z.record(z.string(), chr({
        fanSpeed: chr({
          currentMode: chr({
            value: z.string(),
            values: z.array(z.string()).optional(),
            settable: z.boolean().optional(),
          }).optional(),
          modes: z.record(z.string(), chr({
            value: z.number().optional(),
            minValue: z.number().optional(),
            maxValue: z.number().optional(),
            stepValue: z.number().optional(),
            settable: z.boolean().optional(),
          })).optional(),
        }).optional(),
        fanDirection: chr({
          horizontal: chr({ currentMode: chr({ value: z.string() }).optional() }).optional(),
          vertical: chr({ currentMode: chr({ value: z.string() }).optional() }).optional(),
        }).optional(),
      })),
    }),
  }).optional(),
  powerfulMode: chr({ value: z.string() }).optional(),
  econoMode: chr({ value: z.string() }).optional(),
  streamerMode: chr({ value: z.string() }).optional(),
  holidayMode: chr({
    value: chr({
      enabled: z.boolean(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }),
  }).optional(),
});

// Gateway Device Schema
export const GatewayDeviceSchema = chr({
  id: z.string(),
  deviceModel: z.string().optional(),
  type: z.string().optional(),
  isCloudConnectionUp: chr({ value: z.boolean() }).optional(),
  managementPoints: z.array(ManagementPointSchema),
});

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
      const errorMessages = error.issues.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
      throw new Error(`Validation failed${context ? ` for ${context}` : ''}: ${errorMessages}`, { cause: error });
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
  const errorMessages = result.error.issues.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
  return { success: false, error: errorMessages };
}
