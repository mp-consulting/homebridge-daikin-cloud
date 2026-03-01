export class DaikinCloudRepo {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static maskSensitiveCloudDeviceData(cloudDeviceDetails: any) {
    const cloned = JSON.parse(JSON.stringify(cloudDeviceDetails));
    if (cloned.managementPoints) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cloned.managementPoints = cloned.managementPoints.map((managementPoint: any) => {
        if (managementPoint.ipAddress) {
          managementPoint.ipAddress.value = 'REDACTED';
        }
        if (managementPoint.macAddress) {
          managementPoint.macAddress.value = 'REDACTED';
        }
        if (managementPoint.ssid) {
          managementPoint.ssid.value = 'REDACTED';
        }
        if (managementPoint.serialNumber) {
          managementPoint.serialNumber.value = 'REDACTED';
        }
        if (managementPoint.wifiConnectionSSID) {
          managementPoint.wifiConnectionSSID.value = 'REDACTED';
        }
        if (managementPoint.consumptionData) {
          managementPoint.consumptionData = 'REDACTED';
        }
        if (managementPoint.schedule) {
          managementPoint.schedule = 'REDACTED';
        }

        return managementPoint;
      });
    }
    return cloned;
  }
}
