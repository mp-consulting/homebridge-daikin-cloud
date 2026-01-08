# Accessories

Homebridge accessory classes that represent physical Daikin devices.

## Files

- `base-accessory.ts` - Abstract base class with common accessory functionality (device info logging, capability display)
- `air-conditioning-accessory.ts` - Accessory for standard Daikin air conditioning units
- `altherma-accessory.ts` - Accessory for Daikin Altherma heat pump systems (includes hot water tank support)

## Architecture

```
BaseAccessory (abstract)
├── AirConditioningAccessory
└── AlthermaAccessory
```

Each accessory creates and manages the appropriate services (ClimateControlService, HotWaterTankService) based on the device type.
