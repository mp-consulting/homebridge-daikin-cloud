# Services

HomeKit service implementations that expose Daikin device functionality.

## Files

- `climate-control.service.ts` - HeaterCooler service for temperature control, fan speed, swing mode
- `hot-water-tank.service.ts` - Thermostat service for Altherma hot water tank control

## ClimateControlService

Exposes a HomeKit HeaterCooler with:
- Active state (on/off)
- Current/target temperature
- Operation mode (heat/cool/auto)
- Cooling/heating threshold temperatures
- Rotation speed (fan control)
- Swing mode (if supported)
- Optional feature switches via FeatureManager

## HotWaterTankService

Exposes a HomeKit Thermostat for hot water tanks with:
- Current/target temperature
- Heating state
- Powerful mode switch (if supported)
