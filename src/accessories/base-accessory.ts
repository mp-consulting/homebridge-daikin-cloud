import {PlatformAccessory} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../platform';
import {DeviceCapabilityDetector} from '../device';
import {getCapabilitySummary} from '../device';

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

        this.printDeviceInfo();

        const modelInfo = this.gatewayManagementPointId
            ? (accessory.context.device.getData(this.gatewayManagementPointId, 'modelInfo', undefined).value as string) || 'Unknown'
            : 'Unknown';
        const serialData = this.gatewayManagementPointId
            ? accessory.context.device.getData(this.gatewayManagementPointId, 'serialNumber', undefined)
            : null;
        const serialNumber = serialData ? (serialData.value as string) || 'NOT_AVAILABLE' : 'NOT_AVAILABLE';

        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
            .setCharacteristic(this.platform.Characteristic.Model, modelInfo)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, serialNumber);

        this.accessory.context.device.on('updated', () => {
            this.platform.log.debug(`[API Syncing] Updated ${this.accessory.displayName} (${this.accessory.UUID}), LastUpdated: ${this.accessory.context.device.getLastUpdated()}`);
        });
    }

    printDeviceInfo() {
        this.platform.log.info('[Platform] Device found with id: ' + this.accessory.UUID);
        this.platform.log.info('[Platform]     id: ' + this.accessory.UUID);
        this.platform.log.info('[Platform]     name: ' + this.accessory.displayName);
        this.platform.log.info('[Platform]     last updated: ' + this.accessory.context.device.getLastUpdated());
        const modelInfo = this.gatewayManagementPointId
            ? this.accessory.context.device.getData(this.gatewayManagementPointId, 'modelInfo', undefined).value
            : 'Unknown';
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
        const managementPoints = this.accessory.context.device.desc.managementPoints.filter((managementPoint) => (managementPoint).managementPointType === managementPointType);

        if (managementPoints.length === 0) {
            this.platform.log.error(`[Platform] No management point found for managementPointType ${managementPointType}`);
            return null;
        }

        if (managementPoints.length >= 2) {
            this.platform.log.warn(`[Platform] Found more then one management point for managementPointType ${managementPointType}, we don't expect this, please open an issue on https://github.com/mp-consulting/homebridge-daikin-cloud/issues`);
            return null;
        }

        return managementPoints[0].embeddedId;
    }
}
