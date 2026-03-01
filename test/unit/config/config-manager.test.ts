/**
 * ConfigManager Tests
 */

import type { PluginConfig } from '../../../src/config/config-manager';
import { ConfigManager } from '../../../src/config/config-manager';

describe('ConfigManager', () => {
  describe('getAuthMode', () => {
    it('should return mobile_app when configured', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'mobile_app',
      };
      const manager = new ConfigManager(config);
      expect(manager.getAuthMode()).toBe('mobile_app');
    });

    it('should default to developer_portal when not specified', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
      };
      const manager = new ConfigManager(config);
      expect(manager.getAuthMode()).toBe('developer_portal');
    });
  });

  describe('getDeveloperCredentials', () => {
    it('should return credentials when all fields present', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        callbackServerExternalAddress: 'example.com',
        callbackServerPort: 8582,
      };
      const manager = new ConfigManager(config);
      const creds = manager.getDeveloperCredentials();

      expect(creds).not.toBeNull();
      expect(creds?.clientId).toBe('test-id');
      expect(creds?.clientSecret).toBe('test-secret');
      expect(creds?.callbackServerExternalAddress).toBe('example.com');
      expect(creds?.callbackServerPort).toBe(8582);
    });

    it('should return null when fields missing', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        clientId: 'test-id',
      };
      const manager = new ConfigManager(config);
      expect(manager.getDeveloperCredentials()).toBeNull();
    });
  });

  describe('getMobileCredentials', () => {
    it('should return credentials when present', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        daikinEmail: 'test@example.com',
        daikinPassword: 'password123',
      };
      const manager = new ConfigManager(config);
      const creds = manager.getMobileCredentials();

      expect(creds).not.toBeNull();
      expect(creds?.email).toBe('test@example.com');
      expect(creds?.password).toBe('password123');
    });

    it('should return null when fields missing', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        daikinEmail: 'test@example.com',
      };
      const manager = new ConfigManager(config);
      expect(manager.getMobileCredentials()).toBeNull();
    });
  });

  describe('validate', () => {
    it('should pass validation for valid developer portal config', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'developer_portal',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        callbackServerExternalAddress: '192.168.1.100',
        callbackServerPort: 8582,
      };
      const manager = new ConfigManager(config);
      const result = manager.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for developer portal without clientId', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'developer_portal',
        clientSecret: 'test-secret',
        callbackServerExternalAddress: '192.168.1.100',
      };
      const manager = new ConfigManager(config);
      const result = manager.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Client ID is required for Developer Portal mode');
    });

    it('should fail validation for localhost callback address', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'developer_portal',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        callbackServerExternalAddress: 'localhost',
      };
      const manager = new ConfigManager(config);
      const result = manager.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Callback address cannot be localhost. Use your external IP or domain.');
    });

    it('should fail validation for invalid port', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'developer_portal',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        callbackServerExternalAddress: '192.168.1.100',
        callbackServerPort: 99999,
      };
      const manager = new ConfigManager(config);
      const result = manager.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('port'))).toBe(true);
    });

    it('should warn about privileged port', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'developer_portal',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        callbackServerExternalAddress: '192.168.1.100',
        callbackServerPort: 443,
      };
      const manager = new ConfigManager(config);
      const result = manager.validate();

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Port 443 is privileged (< 1024) and may require root permissions.');
    });

    it('should pass validation for valid mobile app config', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'mobile_app',
        daikinEmail: 'test@example.com',
        daikinPassword: 'password123',
      };
      const manager = new ConfigManager(config);
      const result = manager.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for mobile app without email', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'mobile_app',
        daikinPassword: 'password123',
      };
      const manager = new ConfigManager(config);
      const result = manager.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Email is required for Mobile App mode');
    });

    it('should warn about low update interval for developer portal', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        authMode: 'developer_portal',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        callbackServerExternalAddress: '192.168.1.100',
        updateIntervalInMinutes: 5,
      };
      const manager = new ConfigManager(config);
      const result = manager.validate();

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('rate limit'))).toBe(true);
    });
  });

  describe('getUpdateIntervalMs', () => {
    it('should return configured interval in milliseconds', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        updateIntervalInMinutes: 30,
      };
      const manager = new ConfigManager(config);
      expect(manager.getUpdateIntervalMs()).toBe(30 * 60 * 1000);
    });

    it('should return default interval when not configured', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
      };
      const manager = new ConfigManager(config);
      expect(manager.getUpdateIntervalMs()).toBe(15 * 60 * 1000);
    });
  });

  describe('isDeviceExcluded', () => {
    it('should return true for excluded device', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        excludedDevicesByDeviceId: ['device1', 'device2'],
      };
      const manager = new ConfigManager(config);
      expect(manager.isDeviceExcluded('device1')).toBe(true);
    });

    it('should return false for non-excluded device', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        excludedDevicesByDeviceId: ['device1', 'device2'],
      };
      const manager = new ConfigManager(config);
      expect(manager.isDeviceExcluded('device3')).toBe(false);
    });
  });

  describe('getFeatures', () => {
    it('should return feature configuration', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        showPowerfulMode: true,
        showEconoMode: false,
      };
      const manager = new ConfigManager(config);
      const features = manager.getFeatures();

      expect(features.powerfulMode).toBe(true);
      expect(features.econoMode).toBe(false);
    });

    it('should use legacy showExtraFeatures when present', () => {
      const config: PluginConfig = {
        platform: 'DaikinCloud',
        showExtraFeatures: true,
      };
      const manager = new ConfigManager(config);
      const features = manager.getFeatures();

      // All features should be true when legacy flag is set
      expect(features.powerfulMode).toBe(true);
      expect(features.econoMode).toBe(true);
      expect(features.streamerMode).toBe(true);
    });
  });
});
