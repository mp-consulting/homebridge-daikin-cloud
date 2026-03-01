/**
 * Test Isolation Helpers
 *
 * Provides utilities for better test isolation:
 * - Test context management
 * - Automatic cleanup
 * - Mock factories
 * - Fake timers
 */

import { vi, type SpyInstance } from 'vitest';
import type { Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import type { DaikinCloudAccessoryContext } from '../../src/platform';

/**
 * Test context for managing test lifecycle
 */
export class TestContext {
  private readonly cleanupCallbacks: Array<() => void | Promise<void>> = [];
  private timersMocked = false;

  /**
     * Register a cleanup callback
     */
  onCleanup(callback: () => void | Promise<void>): void {
    this.cleanupCallbacks.push(callback);
  }

  /**
     * Use fake timers for this test
     */
  useFakeTimers(): void {
    if (!this.timersMocked) {
      vi.useFakeTimers();
      this.timersMocked = true;
      this.onCleanup(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        this.timersMocked = false;
      });
    }
  }

  /**
     * Advance timers by time
     */
  async advanceTimersByTime(ms: number): Promise<void> {
    if (!this.timersMocked) {
      throw new Error('Timers must be mocked first. Call useFakeTimers()');
    }
    vi.advanceTimersByTime(ms);
    await Promise.resolve(); // Flush microtasks
  }

  /**
     * Run all timers
     */
  async runAllTimers(): Promise<void> {
    if (!this.timersMocked) {
      throw new Error('Timers must be mocked first. Call useFakeTimers()');
    }
    vi.runAllTimers();
    await Promise.resolve(); // Flush microtasks
  }

  /**
     * Clean up all resources
     */
  async cleanup(): Promise<void> {
    for (const callback of this.cleanupCallbacks.reverse()) {
      await callback();
    }
    this.cleanupCallbacks.length = 0;
  }
}

/**
 * Create a test context for a test
 */
export function createTestContext(): TestContext {
  return new TestContext();
}

/**
 * Create a mock logger
 */
export function createMockLogger(): Logger {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  } as unknown as Logger;

  return logger;
}

/**
 * Create a mock platform config
 */
export function createMockConfig(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    name: 'Test Platform',
    platform: 'DaikinCloud',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    callbackServerExternalAddress: 'test.example.com',
    callbackServerPort: 8582,
    oidcCallbackServerBindAddr: '0.0.0.0',
    updateIntervalInMinutes: 15,
    forceUpdateDelay: 60000,
    showExtraFeatures: false,
    enableWebSocket: true,
    ...overrides,
  } as PlatformConfig;
}

/**
 * Create a mock accessory
 */
export function createMockAccessory(
  displayName: string,
  context?: Partial<DaikinCloudAccessoryContext>,
): PlatformAccessory<DaikinCloudAccessoryContext> {
  const mockContext: DaikinCloudAccessoryContext = {
    device: {} as any,
    useHeaterCooler: false,
    ...context,
  };

  const accessory = {
    UUID: `test-uuid-${displayName}`,
    displayName,
    context: mockContext,
    services: [],
    getService: vi.fn(),
    addService: vi.fn(),
    removeService: vi.fn(),
    getServiceById: vi.fn(),
  } as unknown as PlatformAccessory<DaikinCloudAccessoryContext>;

  return accessory;
}

/**
 * Spy on console methods and restore after cleanup
 */
export function spyOnConsole(context: TestContext): {
    log: SpyInstance;
    warn: SpyInstance;
    error: SpyInstance;
} {
  const spies = {
    log: vi.spyOn(console, 'log').mockImplementation(),
    warn: vi.spyOn(console, 'warn').mockImplementation(),
    error: vi.spyOn(console, 'error').mockImplementation(),
  };

  context.onCleanup(() => {
    spies.log.mockRestore();
    spies.warn.mockRestore();
    spies.error.mockRestore();
  });

  return spies;
}

/**
 * Create isolated test suite with automatic cleanup
 */
export function describeIsolated(name: string, fn: (getContext: () => TestContext) => void): void {
  describe(name, () => {
    let context: TestContext;

    beforeEach(() => {
      context = createTestContext();
    });

    afterEach(async () => {
      await context.cleanup();
    });

    fn(() => context);
  });
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const timeout = options.timeout ?? 5000;
  const interval = options.interval ?? 50;
  const startTime = Date.now();

  while (!(await condition())) {
    if (Date.now() - startTime > timeout) {
      throw new Error('waitFor timeout exceeded');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Create a deferred promise for testing async flows
 */
export function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    } {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}
