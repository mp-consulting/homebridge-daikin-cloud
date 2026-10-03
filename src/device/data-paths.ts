/**
 * Daikin data-point paths
 *
 * Builders for the `/operationModes/<mode>/...` paths used with
 * DaikinCloudDevice.getData / setData, so the string shapes live in one place.
 */

export type FanAxis = 'vertical' | 'horizontal';

export const DataPaths = {
  /** fanControl: the active fan speed mode ('auto' | 'quiet' | 'fixed') for an operation mode. */
  fanSpeedCurrentMode: (operationMode: string): string =>
    `/operationModes/${operationMode}/fanSpeed/currentMode`,

  /** fanControl: the fixed fan speed value (1..maxValue) for an operation mode. */
  fanSpeedFixed: (operationMode: string): string =>
    `/operationModes/${operationMode}/fanSpeed/modes/fixed`,

  /** fanControl: the swing mode of one fan axis for an operation mode. */
  fanDirection: (operationMode: string, axis: FanAxis): string =>
    `/operationModes/${operationMode}/fanDirection/${axis}/currentMode`,

  /** temperatureControl: a setpoint for an operation mode. */
  setpoint: (operationMode: string, setpoint: string): string =>
    `/operationModes/${operationMode}/setpoints/${setpoint}`,
} as const;
