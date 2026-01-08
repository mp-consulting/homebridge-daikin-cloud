# Types

TypeScript type definitions and enums for the Daikin Cloud plugin.

## Files

- `daikin-enums.ts` - Daikin API enum values (operation modes, fan speeds, on/off states, etc.)
- `device-capabilities.ts` - Interfaces for device capability detection and temperature constraints

## Key Types

### Enums
- `DaikinOnOffModes` - ON/OFF states
- `DaikinOperationModes` - COOLING, HEATING, AUTO, DRY, FAN_ONLY
- `DaikinFanSpeedModes` - AUTO, QUIET, FIXED
- `DaikinPowerfulModes`, `DaikinEconoModes`, `DaikinStreamerModes` - Feature modes

### Interfaces
- `DeviceCapabilities` - Boolean flags for supported features
- `TemperatureConstraints` - Min/max/step values for temperature settings
