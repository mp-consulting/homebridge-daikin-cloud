import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // homebridge v2 moved lib/ to dist/ and restricts deep imports via "exports"
      'homebridge/lib/api.js': path.resolve(dirname, 'node_modules/homebridge/dist/api.js'),
      'homebridge/lib/api': path.resolve(dirname, 'node_modules/homebridge/dist/api.js'),
      'homebridge/lib/logger.js': path.resolve(dirname, 'node_modules/homebridge/dist/logger.js'),
      'homebridge/lib/logger': path.resolve(dirname, 'node_modules/homebridge/dist/logger.js'),
      'homebridge/lib/platformAccessory.js': path.resolve(dirname, 'node_modules/homebridge/dist/platformAccessory.js'),
      'homebridge/lib/platformAccessory': path.resolve(dirname, 'node_modules/homebridge/dist/platformAccessory.js'),
      'homebridge/lib/user.js': path.resolve(dirname, 'node_modules/homebridge/dist/user.js'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/**/*.{test,spec}.ts',
      'test/**/*.{test,spec}.ts',
      'tests/**/*.{test,spec}.ts',
    ],
    testTimeout: 10000,
    // Redirects the Homebridge storage path to a temp dir so no test touches ~/.homebridge.
    setupFiles: ['test/helpers/isolated-storage.setup.ts'],
    coverage: {
      provider: 'v8',
      // homebridge-ui/server.js is exercised by test/unit/ui via createRequire and
      // v8 picks it up, so it counts towards the totals.
      include: ['src/**/*.ts', 'homebridge-ui/server.js'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**'],
      // ~3 points below the measured baseline (84.2 / 73.8 / 89.3 / 84.3),
      // so CI fails on real regressions without flaking on small refactors.
      thresholds: {
        statements: 81,
        branches: 70,
        functions: 86,
        lines: 81,
      },
    },
  },
  oxc: {
    target: 'es2022',
  },
});
