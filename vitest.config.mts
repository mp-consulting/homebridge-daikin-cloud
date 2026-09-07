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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**'],
    },
  },
  oxc: {
    target: 'es2022',
  },
});
