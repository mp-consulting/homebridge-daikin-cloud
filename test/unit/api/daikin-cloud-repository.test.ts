import { DaikinCloudRepo } from '../../../src/api/daikin-cloud.repository';

describe('DaikinCloudRepo', () => {
  describe('maskSensitiveCloudDeviceData', () => {
    it('should not mutate the original data', () => {
      const original = {
        id: 'device-1',
        managementPoints: [
          {
            embeddedId: 'gateway',
            ipAddress: { value: '192.168.1.100' },
            macAddress: { value: 'AA:BB:CC:DD:EE:FF' },
            serialNumber: { value: 'SN12345' },
          },
        ],
      };

      DaikinCloudRepo.maskSensitiveCloudDeviceData(original);

      // Original should NOT be mutated
      expect(original.managementPoints[0].ipAddress.value).toBe('192.168.1.100');
      expect(original.managementPoints[0].macAddress.value).toBe('AA:BB:CC:DD:EE:FF');
      expect(original.managementPoints[0].serialNumber.value).toBe('SN12345');
    });

    it('should return masked data in the cloned output', () => {
      const original = {
        id: 'device-1',
        managementPoints: [
          {
            embeddedId: 'gateway',
            ipAddress: { value: '192.168.1.100' },
            macAddress: { value: 'AA:BB:CC:DD:EE:FF' },
            ssid: { value: 'MyNetwork' },
            serialNumber: { value: 'SN12345' },
            wifiConnectionSSID: { value: 'MyNetwork' },
            consumptionData: { value: 'some data' },
            schedule: { value: 'some schedule' },
          },
        ],
      };

      const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(original);

      expect(masked.managementPoints[0].ipAddress.value).toBe('REDACTED');
      expect(masked.managementPoints[0].macAddress.value).toBe('REDACTED');
      expect(masked.managementPoints[0].ssid.value).toBe('REDACTED');
      expect(masked.managementPoints[0].serialNumber.value).toBe('REDACTED');
      expect(masked.managementPoints[0].wifiConnectionSSID.value).toBe('REDACTED');
      expect(masked.managementPoints[0].consumptionData).toBe('REDACTED');
      expect(masked.managementPoints[0].schedule).toBe('REDACTED');
    });

    it('should preserve non-sensitive data', () => {
      const original = {
        id: 'device-1',
        deviceModel: 'DX23',
        managementPoints: [
          {
            embeddedId: 'climateControl',
            onOffMode: { value: 'on' },
            operationMode: { value: 'cooling' },
          },
        ],
      };

      const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(original);

      expect(masked.id).toBe('device-1');
      expect(masked.deviceModel).toBe('DX23');
      expect(masked.managementPoints[0].embeddedId).toBe('climateControl');
      expect(masked.managementPoints[0].onOffMode.value).toBe('on');
    });

    it('should handle data without managementPoints', () => {
      const original = { id: 'device-1', deviceModel: 'Test' };

      const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(original);

      expect(masked.id).toBe('device-1');
      expect(masked.managementPoints).toBeUndefined();
    });

    it('should handle empty managementPoints array', () => {
      const original = { id: 'device-1', managementPoints: [] };

      const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(original);

      expect(masked.managementPoints).toHaveLength(0);
    });

    it('should handle managementPoints without sensitive fields', () => {
      const original = {
        managementPoints: [
          {
            embeddedId: 'climateControl',
            onOffMode: { value: 'on' },
          },
        ],
      };

      const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(original);

      expect(masked.managementPoints[0].onOffMode.value).toBe('on');
    });
  });
});
