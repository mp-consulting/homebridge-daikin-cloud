import type { PlatformAccessory } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../platform';
import { DeviceCapabilityDetector, getCapabilitySummary } from '../device';

export class BaseAccessory {
  readonly platform: DaikinCloudPlatform;
  readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
  public readonly gatewayManagementPointId: string | null;
  constructor(
    platform: DaikinCloudPlatform,
    accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.gatewayManagementPointId = this.getEmbeddedIdByManagementPointType('gateway');

    const modelInfo = this.gatewayManagementPointId
      ? (accessory.context.device.getData(this.gatewayManagementPointId, 'modelInfo', undefined).value as string) || 'Unknown'
      : 'Unknown';
    const serialData = this.gatewayManagementPointId
      ? accessory.context.device.getData(this.gatewayManagementPointId, 'serialNumber', undefined)
      : null;
    const serialNumber = serialData ? (serialData.value as string) || 'NOT_AVAILABLE' : 'NOT_AVAILABLE';

    this.printDeviceInfo(modelInfo);

        this.accessory.getService(this.platform.Service.AccessoryInformation)!
          .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
          .setCharacteristic(this.platform.Characteristic.Model, modelInfo)
          .setCharacteristic(this.platform.Characteristic.SerialNumber, serialNumber);

        const updateListener = () => {
          const name = this.accessory.displayName;
          const uuid = this.accessory.UUID;
          const lastUpdated = this.accessory.context.device.getLastUpdated();
          this.platform.log.debug(
            `[API Syncing] Updated ${name} (${uuid}), LastUpdated: ${lastUpdated}`,
          );
        };
        this.accessory.context.device.on('updated', updateListener);
        this.platform.registerDeviceListener(this.accessory, updateListener);
  }

  private printDeviceInfo(modelInfo: string) {
    this.platform.log.info('[Platform] Device found with id: ' + this.accessory.UUID);
    this.platform.log.info('[Platform]     id: ' + this.accessory.UUID);
    this.platform.log.info('[Platform]     name: ' + this.accessory.displayName);
    this.platform.log.info('[Platform]     last updated: ' + this.accessory.context.device.getLastUpdated());
    this.platform.log.info('[Platform]     modelInfo: ' + modelInfo);
    this.platform.log.info('[Platform]     deviceModel: ' + this.accessory.context.device.getDescription().deviceModel);
  }

  /**
     * Log device capabilities for the given management point.
     * Call this from subclasses after determining the management point ID.
     */
  protected logCapabilities(managementPointId: string): void {
    const detector = new DeviceCapabilityDetector(
      this.accessory.context.device,
      managementPointId,
    );
    const capabilities = detector.getCapabilities();
    const summary = getCapabilitySummary(capabilities);

    this.platform.log.info(`[Platform]     capabilities: ${summary}`);
    this.platform.log.debug(`[Platform]     operation modes: ${capabilities.supportedOperationModes.join(', ')}`);
  }

  getEmbeddedIdByManagementPointType(managementPointType: string): string | null {
    const managementPoints = this.accessory.context.device.desc.managementPoints.filter(
      (managementPoint) => (managementPoint).managementPointType === managementPointType,
    );

    if (managementPoints.length === 0) {
      this.platform.log.error(`[Platform] No management point found for managementPointType ${managementPointType}`);
      return null;
    }

    if (managementPoints.length >= 2) {
      this.platform.log.warn(`[Platform] Found more than one management point for managementPointType ${managementPointType}, using first one. Please open an issue on https://github.com/mp-consulting/homebridge-daikin-cloud/issues`);
    }

    return managementPoints[0].embeddedId;
  }
}
