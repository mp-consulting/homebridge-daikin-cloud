/**
 * Service Factory
 *
 * Centralizes service instantiation with dependency injection support.
 * Provides a clean way to create services with proper dependencies.
 */

import {PlatformAccessory} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../platform';
import {ClimateControlService} from './climate-control.service';
import {HotWaterTankService} from './hot-water-tank.service';

export type ServiceType = 'climateControl' | 'domesticHotWaterTank';

export interface ServiceConfig {
    type: ServiceType;
    embeddedId: string;
}

/**
 * Factory for creating platform services
 */
export class ServiceFactory {
    constructor(private readonly platform: DaikinCloudPlatform) {}

    /**
     * Create a climate control service
     */
    createClimateControlService(
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        embeddedId: string,
    ): ClimateControlService {
        return new ClimateControlService(this.platform, accessory, embeddedId);
    }

    /**
     * Create a hot water tank service
     */
    createHotWaterTankService(
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        embeddedId: string,
    ): HotWaterTankService {
        return new HotWaterTankService(this.platform, accessory, embeddedId);
    }

    /**
     * Create a service by type
     */
    createService(
        type: ServiceType,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        embeddedId: string,
    ): ClimateControlService | HotWaterTankService | null {
        switch (type) {
            case 'climateControl':
                return this.createClimateControlService(accessory, embeddedId);
            case 'domesticHotWaterTank':
                return this.createHotWaterTankService(accessory, embeddedId);
            default:
                this.platform.log.warn(`[ServiceFactory] Unknown service type: ${type}`);
                return null;
        }
    }

    /**
     * Create multiple services from configs
     */
    createServices(
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        configs: ServiceConfig[],
    ): Array<ClimateControlService | HotWaterTankService> {
        return configs
            .map(config => this.createService(config.type, accessory, config.embeddedId))
            .filter((service): service is ClimateControlService | HotWaterTankService => service !== null);
    }

    /**
     * Create services from management points
     */
    createServicesFromManagementPoints(
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    ): {
        climateControl?: ClimateControlService;
        hotWaterTank?: HotWaterTankService;
    } {
        const result: {
            climateControl?: ClimateControlService;
            hotWaterTank?: HotWaterTankService;
        } = {};

        const managementPoints = accessory.context.device.managementPoints || [];

        for (const mp of managementPoints) {
            if (mp.managementPointType === 'climateControl') {
                result.climateControl = this.createClimateControlService(accessory, mp.embeddedId);
            } else if (mp.managementPointType === 'domesticHotWaterTank') {
                result.hotWaterTank = this.createHotWaterTankService(accessory, mp.embeddedId);
            }
        }

        return result;
    }
}
