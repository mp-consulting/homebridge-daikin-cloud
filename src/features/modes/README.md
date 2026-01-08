# Feature Modes

Individual feature implementations for optional Daikin device capabilities.

## Files

| File | Feature | Description |
|------|---------|-------------|
| `powerful-mode.feature.ts` | Powerful Mode | Boost heating/cooling performance |
| `econo-mode.feature.ts` | Econo Mode | Energy-saving operation |
| `streamer-mode.feature.ts` | Streamer Mode | Air purification |
| `outdoor-silent-mode.feature.ts` | Outdoor Silent | Reduce outdoor unit noise |
| `indoor-silent-mode.feature.ts` | Indoor Silent | Reduce indoor unit noise (fan speed) |
| `dry-operation-mode.feature.ts` | Dry Operation | Enable dry mode via switch |
| `fan-only-operation-mode.feature.ts` | Fan Only | Enable fan-only mode via switch |

## Implementation Pattern

Each feature extends `BaseFeature` and implements:

- `isSupported()` - Check if device has this capability
- `getDataKey()` - Daikin API data key (e.g., 'powerfulMode')
- `getOnValue()` / `getOffValue()` - API values for on/off states
