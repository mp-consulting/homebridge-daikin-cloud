# Features

Modular feature system for optional Daikin device capabilities exposed as HomeKit switches.

## Files

- `base-feature.ts` - Abstract base class for all features with common setup/get/set logic
- `feature-manager.ts` - Orchestrates feature detection and setup for an accessory
- `modes/` - Individual feature implementations

## Architecture

The FeatureManager detects which features a device supports and creates the appropriate HomeKit switch services.

```
FeatureManager
└── manages multiple BaseFeature implementations
    ├── PowerfulModeFeature
    ├── EconoModeFeature
    ├── StreamerModeFeature
    └── ... (see modes/ folder)
```

## Adding a New Feature

1. Create a new file in `modes/` extending `BaseFeature`
2. Implement `isSupported()`, `getDataKey()`, `getOnValue()`, `getOffValue()`
3. Register in `feature-manager.ts`
