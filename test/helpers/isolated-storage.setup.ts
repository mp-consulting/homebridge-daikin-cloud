/**
 * Vitest setup file (see vitest.config.mts): points the Homebridge storage path
 * at a throw-away temp directory for every test file, so a DaikinCloudPlatform
 * built with a real HomebridgeAPI never reads, stats or writes the developer's
 * real ~/.homebridge (token set, rate-limit status file, ...).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { User } from 'homebridge/lib/user.js';

const storagePath = mkdtempSync(join(tmpdir(), 'daikin-cloud-test-'));

try {
  User.setStoragePath(storagePath);
} catch {
  // The module instance was reused and already accessed: override it directly.
  (User as unknown as { customStoragePath: string }).customStoragePath = storagePath;
}

afterAll(() => {
  rmSync(storagePath, { recursive: true, force: true });
});
