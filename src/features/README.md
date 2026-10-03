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

## Switch identity

Switches are found by `(Service.Switch, subtype)`, never by display name. New
switches get a subtype namespaced to their management point
(`<managementPointId>:<subtype>`), so the climateControl and the Altherma
domesticHotWaterTank features cannot touch each other's switches. Switches cached
by older versions (bare `<subtype>`) are adopted as-is by the one management point
that owns them, keeping their HomeKit identity and automations (see
`BaseFeature.ownsLegacyService`).

## Adding a New Feature

1. For a plain on/off data point, extend `OnOffDataPointFeature` and declare a
   `spec` (name, subtype, configKey, dataPoint, optional path, onValue, offValue,
   capability). Otherwise extend `BaseFeature`.
2. Read support from `this.capabilities` (detected once per management point by
   `DeviceCapabilityDetector`; add a field there if needed).
3. Register it in `CLIMATE_CONTROL_FEATURES` (or `HOT_WATER_TANK_FEATURES`) in `feature-manager.ts`.
