import { vi } from 'vitest';
import type { DeviceUpdate } from '../../../src/utils/update-mapper';
import { UpdateMapper } from '../../../src/utils/update-mapper';

// Mock homebridge types
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
};

// Mock characteristic values
const CharacteristicMock = {
  Active: Object.assign(vi.fn(), { ACTIVE: 1, INACTIVE: 0 }),
  CurrentHeaterCoolerState: Object.assign(vi.fn(), { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 }),
  TargetHeaterCoolerState: Object.assign(vi.fn(), { AUTO: 0, HEAT: 1, COOL: 2 }),
  CurrentHeatingCoolingState: Object.assign(vi.fn(), { OFF: 0, HEAT: 1, COOL: 2 }),
  TargetHeatingCoolingState: Object.assign(vi.fn(), { OFF: 0, HEAT: 1, COOL: 2, AUTO: 3 }),
  CurrentTemperature: vi.fn(),
  HeatingThresholdTemperature: vi.fn(),
  CoolingThresholdTemperature: vi.fn(),
};

const ServiceMock = {
  HeaterCooler: 'HeaterCooler',
  Thermostat: 'Thermostat',
};

function createMockAccessory(serviceType: string, deviceData: Record<string, unknown> = {}) {
  const updatedCharacteristics: Array<{char: unknown; value: unknown}> = [];
  const mockService = {
    updateCharacteristic: vi.fn((char, value) => {
      updatedCharacteristics.push({ char, value });
    }),
  };

  return {
    accessory: {
      getService: vi.fn((type: string) => {
        if (type === serviceType) {
          return mockService;
        }
        return undefined;
      }),
      context: {
        device: {
          getId: () => 'device-1',
          getData: (embeddedId: string, dataPoint: string) => {
            return deviceData[dataPoint] || { value: undefined };
          },
        },
      },
    } as any,
    mockService,
    updatedCharacteristics,
  };
}

describe('UpdateMapper', () => {
  let mapper: UpdateMapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mapper = new UpdateMapper(mockLogger as any, ServiceMock as any, CharacteristicMock as any);
  });

  describe('applyUpdate', () => {
    it('should return unsuccessful result when no service found', () => {
      const { accessory } = createMockAccessory('UnknownService');
      const update: DeviceUpdate = {
        deviceId: 'device-1',
        embeddedId: 'climateControl',
        characteristicName: 'onOffMode',
        data: { value: 'on' },
      };

      const result = mapper.applyUpdate(accessory, update);
      expect(result.success).toBe(false);
      expect(result.updated).toHaveLength(0);
    });

    describe('onOffMode updates', () => {
      it('should update HeaterCooler Active to ACTIVE when turned on', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler');
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'onOffMode',
          data: { value: 'on' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.Active,
          CharacteristicMock.Active.ACTIVE,
        );
      });

      it('should update HeaterCooler Active to INACTIVE and state when turned off', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler');
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'onOffMode',
          data: { value: 'off' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(result.updated).toContain('Active=INACTIVE');
        expect(result.updated).toContain('CurrentHeaterCoolerState=INACTIVE');
        expect(mockService.updateCharacteristic).toHaveBeenCalledTimes(2);
      });

      it('should update Thermostat CurrentHeatingCoolingState when turned off', () => {
        const { accessory, mockService } = createMockAccessory('Thermostat', {
          operationMode: { value: 'heating' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'onOffMode',
          data: { value: 'off' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.CurrentHeatingCoolingState,
          CharacteristicMock.CurrentHeatingCoolingState.OFF,
        );
      });

      it('should map heating operation mode for thermostat when on', () => {
        const { accessory, mockService } = createMockAccessory('Thermostat', {
          operationMode: { value: 'heating' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'onOffMode',
          data: { value: 'on' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.CurrentHeatingCoolingState,
          CharacteristicMock.CurrentHeatingCoolingState.HEAT,
        );
      });

      it('should map cooling operation mode for thermostat when on', () => {
        const { accessory, mockService } = createMockAccessory('Thermostat', {
          operationMode: { value: 'cooling' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'onOffMode',
          data: { value: 'on' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.CurrentHeatingCoolingState,
          CharacteristicMock.CurrentHeatingCoolingState.COOL,
        );
      });
    });

    describe('operationMode updates', () => {
      it('should not update target state when device is off', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler', {
          onOffMode: { value: 'off' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'operationMode',
          data: { value: 'cooling' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(false);
        expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
      });

      it('should map cooling mode to HeaterCooler COOL', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler', {
          onOffMode: { value: 'on' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'operationMode',
          data: { value: 'cooling' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.TargetHeaterCoolerState,
          CharacteristicMock.TargetHeaterCoolerState.COOL,
        );
      });

      it('should map heating mode to HeaterCooler HEAT', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler', {
          onOffMode: { value: 'on' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'operationMode',
          data: { value: 'heating' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(result.updated).toContain('TargetHeaterCoolerState=1');
        expect(result.updated).toContain('CurrentHeaterCoolerState=2');
      });

      it('should map auto mode to HeaterCooler AUTO', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler', {
          onOffMode: { value: 'on' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'operationMode',
          data: { value: 'auto' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.TargetHeaterCoolerState,
          CharacteristicMock.TargetHeaterCoolerState.AUTO,
        );
      });

      it('should handle unknown operation mode gracefully', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler', {
          onOffMode: { value: 'on' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'operationMode',
          data: { value: 'dry' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(false);
        expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
      });

      it('should map cooling mode for thermostat', () => {
        const { accessory, mockService } = createMockAccessory('Thermostat', {
          onOffMode: { value: 'on' },
        });
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'operationMode',
          data: { value: 'cooling' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.TargetHeatingCoolingState,
          CharacteristicMock.TargetHeatingCoolingState.COOL,
        );
      });
    });

    describe('sensoryData updates', () => {
      it('should update current temperature from roomTemperature', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler');
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'sensoryData',
          data: { value: { roomTemperature: { value: 22.5 } } },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.CurrentTemperature,
          22.5,
        );
      });

      it('should not update when sensoryData has no roomTemperature', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler');
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'sensoryData',
          data: { value: { outdoorTemperature: { value: 15 } } },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(false);
        expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
      });
    });

    describe('temperatureControl updates', () => {
      it('should update heating threshold temperature', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler');
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'temperatureControl',
          data: {
            value: {
              operationModes: {
                heating: { setpoints: { roomTemperature: { value: 22 } } },
              },
            },
          },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.HeatingThresholdTemperature,
          22,
        );
      });

      it('should update cooling threshold temperature', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler');
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'temperatureControl',
          data: {
            value: {
              operationModes: {
                cooling: { setpoints: { roomTemperature: { value: 26 } } },
              },
            },
          },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(mockService.updateCharacteristic).toHaveBeenCalledWith(
          CharacteristicMock.CoolingThresholdTemperature,
          26,
        );
      });

      it('should update both heating and cooling thresholds', () => {
        const { accessory, mockService } = createMockAccessory('HeaterCooler');
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'temperatureControl',
          data: {
            value: {
              operationModes: {
                heating: { setpoints: { roomTemperature: { value: 20 } } },
                cooling: { setpoints: { roomTemperature: { value: 28 } } },
              },
            },
          },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(true);
        expect(result.updated).toHaveLength(2);
        expect(mockService.updateCharacteristic).toHaveBeenCalledTimes(2);
      });
    });

    describe('unhandled characteristics', () => {
      it('should log debug message for unknown characteristic', () => {
        const { accessory } = createMockAccessory('HeaterCooler');
        const update: DeviceUpdate = {
          deviceId: 'device-1',
          embeddedId: 'climateControl',
          characteristicName: 'unknownCharacteristic',
          data: { value: 'something' },
        };

        const result = mapper.applyUpdate(accessory, update);
        expect(result.success).toBe(false);
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Unhandled characteristic'),
        );
      });
    });
  });
});
