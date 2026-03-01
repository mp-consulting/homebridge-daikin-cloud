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
  }
}
