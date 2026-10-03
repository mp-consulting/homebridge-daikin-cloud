/**
 * Separate Fan service
 *
 * HomeKit hides the HeaterCooler's RotationSpeed slider and SwingMode toggle
 * when the accessory is grouped into a single tile in the Home app — they're
 * only reachable by opening the device directly. Exposing a separate Fanv2
 * service gives the fan speed slider and oscillation toggle their own tile that
 * stays visible even when grouped.
 *
 * Gated behind the `showSeparateFanControl` config option, and only added when
 * the device actually exposes a fixed fan speed and/or a swing mode. The fan's
 * Active characteristic mirrors the unit on/off state, and its RotationSpeed /
 * SwingMode reuse the HeaterCooler's handlers so both services stay in sync.
 */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../../platform';
import { percentStep } from './fan-speed';

const SUBTYPE = 'separate_fan';

type Getter = () => Promise<CharacteristicValue>;
type Setter = (value: CharacteristicValue) => Promise<void>;

export interface SeparateFanHandlers {
  getActive: Getter;
  setActive: Setter;
  getRotationSpeed: Getter;
  setRotationSpeed: Setter;
  getSwing: Getter;
  setSwing: Setter;
}

export interface SeparateFanCapabilities {
  /** Fixed fan speed maxValue, or undefined when the device has no fixed fan speed. */
  fanSpeedMax?: number;
  hasFanSpeed: boolean;
  hasSwing: boolean;
}

export class SeparateFanService {
  private service?: Service;

  constructor(
    private readonly platform: DaikinCloudPlatform,
    private readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    private readonly name: string,
  ) {}

  setup(capabilities: SeparateFanCapabilities, handlers: SeparateFanHandlers): void {
    const { Characteristic } = this.platform;
    const existing = this.accessory.getServiceById(this.platform.Service.Fanv2, SUBTYPE);
    const enabled = this.platform.configManager.isFeatureEnabled('showSeparateFanControl');

    if (!enabled || (!capabilities.hasFanSpeed && !capabilities.hasSwing)) {
      if (existing) {
        this.platform.log.debug(`[${this.name}] Removing separate Fan service`);
        this.accessory.removeService(existing);
      }
      this.service = undefined;
      return;
    }

    const fanName = `${this.name} Fan`;
    this.platform.log.debug(`[${this.name}] Adding separate Fan service`);
    const service = existing || this.accessory.addService(this.platform.Service.Fanv2, fanName, SUBTYPE);
    this.service = service;
    service.setCharacteristic(Characteristic.Name, fanName);
    service.addOptionalCharacteristic(Characteristic.ConfiguredName);
    service.setCharacteristic(Characteristic.ConfiguredName, fanName);

    service.getCharacteristic(Characteristic.Active)
      .onGet(handlers.getActive)
      .onSet(handlers.setActive);

    if (capabilities.hasFanSpeed) {
      service.getCharacteristic(Characteristic.RotationSpeed)
        .setProps({ minStep: percentStep(capabilities.fanSpeedMax), minValue: 0, maxValue: 100 })
        .onGet(handlers.getRotationSpeed)
        .onSet(handlers.setRotationSpeed);
    } else {
      service.removeCharacteristic(service.getCharacteristic(Characteristic.RotationSpeed));
    }

    if (capabilities.hasSwing) {
      service.getCharacteristic(Characteristic.SwingMode)
        .onGet(handlers.getSwing)
        .onSet(handlers.setSwing);
    }
  }

  updateActive(isOn: boolean): void {
    const { Active } = this.platform.Characteristic;
    this.service?.getCharacteristic(Active).updateValue(isOn ? Active.ACTIVE : Active.INACTIVE);
  }

  updateRotationSpeed(percent: number): void {
    const { RotationSpeed } = this.platform.Characteristic;
    if (this.service?.testCharacteristic(RotationSpeed)) {
      this.service.getCharacteristic(RotationSpeed).updateValue(percent);
    }
  }

  updateSwing(swingMode: number): void {
    this.service?.getCharacteristic(this.platform.Characteristic.SwingMode).updateValue(swingMode);
  }
}
