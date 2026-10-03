/**
 * FEATURE_CONFIG_KEYS must match the feature toggles declared in
 * config.schema.json and the ones the custom UI (homebridge-ui/public/script.js)
 * renders, so a new toggle cannot be added in one place only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FEATURE_CONFIG_KEYS } from '../../../src/config/config-manager';

const rootDir = path.resolve(__dirname, '..', '..', '..');
const LEGACY_KEY = 'showExtraFeatures';

/** Parse a `NAME: ['a', 'b', ...]` array literal from the UI script */
function readUiArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`\\b${name}\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!match) {
    throw new Error(`${name} not found in script.js`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('FEATURE_CONFIG_KEYS', () => {
  const allKeys = [...FEATURE_CONFIG_KEYS.extra, ...FEATURE_CONFIG_KEYS.standalone];

  it('has no duplicates', () => {
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it('matches the show* properties of config.schema.json', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(rootDir, 'config.schema.json'), 'utf8'));
    const schemaKeys = Object.keys(schema.schema.properties).filter(key => key.startsWith('show') && key !== LEGACY_KEY);
    expect([...allKeys].sort()).toEqual([...schemaKeys].sort());
    expect(schema.schema.properties[LEGACY_KEY]).toBeDefined();
    for (const key of allKeys) {
      expect(schema.schema.properties[key].type).toBe('boolean');
    }
    // A schema default would be written into the config by the Homebridge UI
    // and silently disable the showExtraFeatures fallback.
    for (const key of FEATURE_CONFIG_KEYS.extra) {
      expect(schema.schema.properties[key], key).not.toHaveProperty('default');
    }
  });

  it('matches FEATURE_KEYS / STANDALONE_KEYS of the custom UI', () => {
    const source = fs.readFileSync(path.join(rootDir, 'homebridge-ui', 'public', 'script.js'), 'utf8');
    expect([...readUiArray(source, 'FEATURE_KEYS')].sort()).toEqual([...FEATURE_CONFIG_KEYS.extra].sort());
    expect([...readUiArray(source, 'STANDALONE_KEYS')].sort()).toEqual([...FEATURE_CONFIG_KEYS.standalone].sort());
  });
});
