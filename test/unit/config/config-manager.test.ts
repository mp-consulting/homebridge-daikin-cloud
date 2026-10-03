/**
 * ConfigManager Tests
 */

import type { FeatureConfigKey, PluginConfig } from '../../../src/config/config-manager';
import { ConfigManager, FEATURE_CONFIG_KEYS, validateConfig } from '../../../src/config/config-manager';
import {
  DEFAULT_CALLBACK_BIND_ADDR,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_FORCE_UPDATE_DELAY_MS,
} from '../../../src/constants';

const developerPortal: PluginConfig = {
  platform: 'DaikinCloud',
  authMode: 'developer_portal',
  clientId: 'test-id',
  clientSecret: 'test-secret',
  callbackServerExternalAddress: '192.168.1.100',
  callbackServerPort: 8582,
};

const mobileApp: PluginConfig = {
  platform: 'DaikinCloud',
  authMode: 'mobile_app',
  daikinEmail: 'test@example.com',
  daikinPassword: 'password123',
};

const manager = (config: Partial<PluginConfig> | Record<string, unknown>) =>
  new ConfigManager({ platform: 'DaikinCloud', ...config } as PluginConfig);

describe('ConfigManager', () => {
  describe('getAuthMode', () => {
    it('should return mobile_app when configured', () => {
      expect(manager({ authMode: 'mobile_app' }).getAuthMode()).toBe('mobile_app');
      expect(manager({ authMode: 'mobile_app' }).isMobileAppMode()).toBe(true);
    });

    it('should default to developer_portal when not specified or unknown', () => {
      expect(manager({}).getAuthMode()).toBe('developer_portal');
      expect(manager({ authMode: 'bogus' }).getAuthMode()).toBe('developer_portal');
    });
  });

  describe('hasDeveloperCredentials', () => {
    it('requires both client ID and secret', () => {
      expect(manager({ clientId: 'id', clientSecret: 'secret' }).hasDeveloperCredentials()).toBe(true);
      expect(manager({ clientId: 'id' }).hasDeveloperCredentials()).toBe(false);
      expect(manager({ clientId: '', clientSecret: 'secret' }).hasDeveloperCredentials()).toBe(false);
    });
  });

  describe('getMobileCredentials', () => {
    it('should return credentials when present', () => {
      expect(new ConfigManager(mobileApp).getMobileCredentials()).toEqual({ email: 'test@example.com', password: 'password123' });
    });

    it('should return null when fields missing', () => {
      expect(manager({ daikinEmail: 'test@example.com' }).getMobileCredentials()).toBeNull();
    });

    it('should accept the legacy email/password keys documented in older READMEs', () => {
      const m = manager({ email: 'legacy@example.com', password: 'legacy-password' });
      expect(m.getMobileCredentials()).toEqual({ email: 'legacy@example.com', password: 'legacy-password' });
      expect(m.getLegacyCredentialKeysInUse()).toEqual(['email', 'password']);
    });

    it('should prefer the canonical keys over the legacy aliases', () => {
      const m = manager({
        daikinEmail: 'canonical@example.com',
        daikinPassword: 'canonical-password',
        email: 'legacy@example.com',
        password: 'legacy-password',
      });
      expect(m.getMobileCredentials()).toEqual({ email: 'canonical@example.com', password: 'canonical-password' });
      expect(m.getLegacyCredentialKeysInUse()).toEqual([]);
    });
  });

  describe('getControllerConfig', () => {
    it('passes the developer portal settings through', () => {
      const config = new ConfigManager({ ...developerPortal, callbackServerPort: 9000, oidcCallbackServerBindAddr: '127.0.0.1' })
        .getControllerConfig('/tmp/token');
      expect(config).toEqual({
        authMode: 'developer_portal',
        tokenFilePath: '/tmp/token',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        callbackServerExternalAddress: '192.168.1.100',
        callbackServerPort: 9000,
        oidcCallbackServerBindAddr: '127.0.0.1',
        email: undefined,
        password: undefined,
      });
    });

    it('applies the callback port and bind address defaults', () => {
      const config = manager({ clientId: 'id', clientSecret: 'secret' }).getControllerConfig('/tmp/token');
      expect(config.callbackServerPort).toBe(DEFAULT_CALLBACK_PORT);
      expect(config.oidcCallbackServerBindAddr).toBe(DEFAULT_CALLBACK_BIND_ADDR);
    });

    it.each([
      ['a numeric string', '9000', 9000],
      ['an invalid port', 99999, DEFAULT_CALLBACK_PORT],
      ['a non-numeric string', 'abc', DEFAULT_CALLBACK_PORT],
      ['an empty string', '', DEFAULT_CALLBACK_PORT],
    ])('normalizes %s as callback port', (_label, port, expected) => {
      expect(manager({ callbackServerPort: port }).getControllerConfig('/t').callbackServerPort).toBe(expected);
    });

    it('resolves the mobile credentials, including the legacy keys', () => {
      const config = manager({ authMode: 'mobile_app', email: 'legacy@example.com', daikinPassword: 'pw' }).getControllerConfig('/t');
      expect(config.authMode).toBe('mobile_app');
      expect(config.email).toBe('legacy@example.com');
      expect(config.password).toBe('pw');
    });
  });

  describe('validate', () => {
    it('should pass validation for valid developer portal config', () => {
      const result = new ConfigManager(developerPortal).validate();
      expect(result).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('should fail validation for developer portal with missing fields', () => {
      const result = manager({ authMode: 'developer_portal' }).validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        'Client ID is required for Developer Portal mode',
        'Client Secret is required for Developer Portal mode',
        'Callback Server Address is required for Developer Portal mode',
      ]);
    });

    it.each(['localhost', '127.0.0.1'])('should fail validation for %s callback address', (address) => {
      const result = new ConfigManager({ ...developerPortal, callbackServerExternalAddress: address }).validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['Callback address cannot be localhost. Use your external IP or domain.']);
    });

    it.each([99999, 0, 'abc', 1.5])('should fail validation for invalid port %s', (port) => {
      const result = new ConfigManager({ ...developerPortal, callbackServerPort: port as number }).validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('port'))).toBe(true);
    });

    it('should accept a numeric string port and treat empty/null as unset', () => {
      expect(new ConfigManager({ ...developerPortal, callbackServerPort: '8582' }).validate().valid).toBe(true);
      expect(new ConfigManager({ ...developerPortal, callbackServerPort: '' }).validate().valid).toBe(true);
      expect(manager({ ...developerPortal, callbackServerPort: null }).validate().valid).toBe(true);
    });

    it('should warn about privileged port', () => {
      const result = new ConfigManager({ ...developerPortal, callbackServerPort: 443 }).validate();
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Port 443 is privileged (< 1024) and may require root permissions.');
    });

    it('should pass validation for valid mobile app config', () => {
      expect(new ConfigManager(mobileApp).validate()).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('should fail validation for mobile app without credentials', () => {
      const result = manager({ authMode: 'mobile_app' }).validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        'Email is required for Mobile App mode (config key: "daikinEmail")',
        'Password is required for Mobile App mode (config key: "daikinPassword")',
      ]);
    });

    it('should not require developer portal fields in mobile app mode', () => {
      expect(new ConfigManager(mobileApp).validate().errors).toEqual([]);
    });

    it('should warn when mobile credentials come from the legacy keys', () => {
      const result = manager({ authMode: 'mobile_app', email: 'legacy@example.com', password: 'legacy-password' }).validate();
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('daikinEmail'))).toBe(true);
    });

    it('should warn about low update interval for developer portal only', () => {
      const dev = new ConfigManager({ ...developerPortal, updateIntervalInMinutes: 5 }).validate();
      expect(dev.valid).toBe(true);
      expect(dev.warnings.some(w => w.includes('rate limit'))).toBe(true);

      const mobile = new ConfigManager({ ...mobileApp, updateIntervalInMinutes: 5 }).validate();
      expect(mobile.warnings).toEqual([]);
    });

    it('should warn (not fail) about out-of-range intervals, which are clamped', () => {
      const result = new ConfigManager({ ...mobileApp, updateIntervalInMinutes: 120, forceUpdateDelay: 1000 }).validate();
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([
        expect.stringContaining('Using 60 minutes'),
        expect.stringContaining('Using 5000 ms'),
      ]);
    });

    it('validateConfig is the same pure function', () => {
      expect(validateConfig(developerPortal)).toEqual(new ConfigManager(developerPortal).validate());
    });
  });

  describe('getUpdateIntervalMs', () => {
    it.each([
      ['unset', undefined, 15],
      ['0', 0, 15],
      ['non-numeric', 'abc', 15],
      ['a number', 30, 30],
      ['a numeric string', '5', 5],
      ['below the minimum', 0.5, 1],
      ['negative', -5, 1],
      ['above the maximum', 120, 60],
    ])('%s', (_label, value, expectedMinutes) => {
      expect(manager({ updateIntervalInMinutes: value }).getUpdateIntervalMs()).toBe(expectedMinutes * 60 * 1000);
    });
  });

  describe('getForceUpdateDelayMs', () => {
    it.each([
      ['unset', undefined, DEFAULT_FORCE_UPDATE_DELAY_MS],
      ['0', 0, DEFAULT_FORCE_UPDATE_DELAY_MS],
      ['a number', 10000, 10000],
      ['a numeric string', '20000', 20000],
      ['below the minimum', 1000, 5000],
      ['above the maximum', 600000, 300000],
    ])('%s', (_label, value, expected) => {
      expect(manager({ forceUpdateDelay: value }).getForceUpdateDelayMs()).toBe(expected);
    });
  });

  describe('isDeviceExcluded', () => {
    it('matches only listed device IDs', () => {
      const m = manager({ excludedDevicesByDeviceId: ['device1', 'device2'] });
      expect(m.isDeviceExcluded('device1')).toBe(true);
      expect(m.isDeviceExcluded('device3')).toBe(false);
    });

    it('ignores a malformed exclusion list', () => {
      expect(manager({}).isDeviceExcluded('device1')).toBe(false);
      // A string is not a list: must not match its characters
      expect(manager({ excludedDevicesByDeviceId: 'd' }).isDeviceExcluded('d')).toBe(false);
    });
  });

  describe('isWebSocketEnabled', () => {
    it('is on unless explicitly disabled', () => {
      expect(manager({}).isWebSocketEnabled()).toBe(true);
      expect(manager({ enableWebSocket: true }).isWebSocketEnabled()).toBe(true);
      expect(manager({ enableWebSocket: false }).isWebSocketEnabled()).toBe(false);
    });
  });

  describe('platform settings', () => {
    it('returns the name and HTTP transport', () => {
      const m = manager({ name: 'Daikin', httpTransport: 'curl' });
      expect(m.getName()).toBe('Daikin');
      expect(m.getHttpTransport()).toBe('curl');
      expect(manager({ httpTransport: 'bogus' }).getHttpTransport()).toBeUndefined();
    });

    it('masks credentials and device IDs in the redacted config', () => {
      const redacted = manager({
        ...developerPortal,
        daikinPassword: 'secret-password',
        excludedDevicesByDeviceId: ['0123456789abcdef'],
      }).getRedactedConfig() as Record<string, unknown>;
      const json = JSON.stringify(redacted);
      expect(json).not.toContain('test-secret');
      expect(json).not.toContain('secret-password');
      expect(json).not.toContain('0123456789abcdef');
      expect(redacted.callbackServerExternalAddress).toBe('192.168.1.100');
    });
  });

  describe('isFeatureEnabled', () => {
    // Per-feature value × showExtraFeatures → expected, for each feature kind
    const values: Array<[string, unknown]> = [['absent', undefined], ['null', null], ['true', true], ['false', false]];
    const extraCases = values.flatMap(([label, value]) => [true, false].map(legacy => ({
      label,
      value,
      legacy,
      expected: typeof value === 'boolean' ? value : legacy,
    })));
    const standaloneCases = values.flatMap(([label, value]) => [true, false].map(legacy => ({
      label,
      value,
      legacy,
      expected: value === true,
    })));

    const build = (key: FeatureConfigKey, value: unknown, legacy: boolean) => {
      const config: Record<string, unknown> = { showExtraFeatures: legacy };
      if (value !== undefined) {
        config[key] = value;
      }
      return manager(config);
    };

    describe.each(FEATURE_CONFIG_KEYS.extra)('extra feature %s', (key) => {
      it.each(extraCases)('$label with showExtraFeatures=$legacy → $expected', ({ value, legacy, expected }) => {
        expect(build(key, value, legacy).isFeatureEnabled(key)).toBe(expected);
      });
    });

    describe.each(FEATURE_CONFIG_KEYS.standalone)('standalone feature %s', (key) => {
      it.each(standaloneCases)('$label with showExtraFeatures=$legacy → $expected', ({ value, legacy, expected }) => {
        expect(build(key, value, legacy).isFeatureEnabled(key)).toBe(expected);
      });
    });

    it('treats a non-boolean per-feature value like an absent one', () => {
      expect(manager({ showExtraFeatures: true, showPowerfulMode: 'false' }).isFeatureEnabled('showPowerfulMode')).toBe(true);
      expect(manager({ showSeparateFanControl: 'true' }).isFeatureEnabled('showSeparateFanControl')).toBe(false);
    });

    it('defaults every feature to off', () => {
      const m = manager({});
      for (const key of [...FEATURE_CONFIG_KEYS.extra, ...FEATURE_CONFIG_KEYS.standalone]) {
        expect(m.isFeatureEnabled(key)).toBe(false);
      }
    });
  });
});
