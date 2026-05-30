import type { PlatformAccessory } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../platform';
import { BaseAccessory } from './base-accessory';
import { ClimateControlService } from '../services';

export class AirConditioningAccessory extends BaseAccessory {
  service: ClimateControlService;

  constructor(
    platform: DaikinCloudPlatform,
    accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
  ) {
    super(platform, accessory);
    const climateControlEmbeddedId = this.getEmbeddedIdByManagementPointType('climateControl');

    if (climateControlEmbeddedId === null) {
      throw new Error('No climate control management point found');
    }

    this.service = new ClimateControlService(this.platform, this.accessory, climateControlEmbeddedId);
    this.logCapabilities(climateControlEmbeddedId);

    // Push current device state into HomeKit immediately. At startup the device
    // is freshly built from getCloudDevices() which does not emit 'updated', so
    // without this the full refresh only runs on the first poll/WebSocket event -
    // leaving on/off, mode, swing and feature switches showing stale cached
    // values until the user toggles something.
    this.refreshValues();
  }

  protected override refreshValues(): void {
    this.service.refreshValues();
  }
}
