# Device

Device detection, capability analysis, and factory pattern for creating accessories.

## Files

- `accessory-factory.ts` - Factory for creating appropriate accessory types based on device profile
- `capability-detector.ts` - Detects device capabilities (features, temperature ranges, etc.)
- `capability-docs.ts` - Generates human-readable capability documentation for logging
- `profiles/` - Device profile definitions for matching device types

## Architecture

```
AccessoryFactory
├── uses DeviceProfiles to identify device type
├── uses CapabilityDetector to analyze features
└── creates appropriate Accessory (AirConditioning or Altherma)
```

## Device Detection Flow

1. `AccessoryFactory` receives a Homebridge accessory with device context
2. Matches device against profiles in `profiles/`
3. `CapabilityDetector` analyzes available features
4. Factory creates the appropriate accessory type
