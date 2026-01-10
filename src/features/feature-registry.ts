/**
 * Feature Registry
 *
 * Implements a plugin/registry pattern for features.
 * Allows features to be registered, discovered, and instantiated dynamically.
 */

import {PlatformAccessory} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../platform';
import {BaseFeature} from './base-feature';

/**
 * Feature metadata for registration
 */
export interface FeatureMetadata {
    id: string;
    name: string;
    description: string;
    category: 'mode' | 'sensor' | 'control' | 'other';
    requiresCapability?: string;
    configKey?: string;
}

/**
 * Feature constructor with metadata
 */
export interface FeaturePlugin {
    metadata: FeatureMetadata;
    factory: FeatureFactory;
}

/**
 * Feature factory function
 */
export type FeatureFactory = (
    platform: DaikinCloudPlatform,
    accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    managementPointId: string,
) => BaseFeature;

/**
 * Registry for managing feature plugins
 */
export class FeatureRegistry {
    private static instance: FeatureRegistry;
    private readonly features = new Map<string, FeaturePlugin>();

    private constructor() {
        // Private constructor for singleton
    }

    /**
     * Get the singleton instance
     */
    static getInstance(): FeatureRegistry {
        if (!FeatureRegistry.instance) {
            FeatureRegistry.instance = new FeatureRegistry();
        }
        return FeatureRegistry.instance;
    }

    /**
     * Register a feature plugin
     */
    register(plugin: FeaturePlugin): void {
        if (this.features.has(plugin.metadata.id)) {
            throw new Error(`Feature with id '${plugin.metadata.id}' is already registered`);
        }
        this.features.set(plugin.metadata.id, plugin);
    }

    /**
     * Register multiple feature plugins
     */
    registerBatch(plugins: FeaturePlugin[]): void {
        for (const plugin of plugins) {
            this.register(plugin);
        }
    }

    /**
     * Unregister a feature plugin
     */
    unregister(id: string): boolean {
        return this.features.delete(id);
    }

    /**
     * Get a registered feature plugin
     */
    get(id: string): FeaturePlugin | undefined {
        return this.features.get(id);
    }

    /**
     * Get all registered feature plugins
     */
    getAll(): FeaturePlugin[] {
        return Array.from(this.features.values());
    }

    /**
     * Get features by category
     */
    getByCategory(category: FeatureMetadata['category']): FeaturePlugin[] {
        return this.getAll().filter(f => f.metadata.category === category);
    }

    /**
     * Get feature IDs
     */
    getIds(): string[] {
        return Array.from(this.features.keys());
    }

    /**
     * Check if a feature is registered
     */
    has(id: string): boolean {
        return this.features.has(id);
    }

    /**
     * Get the count of registered features
     */
    count(): number {
        return this.features.size;
    }

    /**
     * Clear all registered features (useful for testing)
     */
    clear(): void {
        this.features.clear();
    }

    /**
     * Create feature instances for an accessory
     */
    createFeatures(
        platform: DaikinCloudPlatform,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        managementPointId: string,
        filter?: (plugin: FeaturePlugin) => boolean,
    ): BaseFeature[] {
        const plugins = filter ? this.getAll().filter(filter) : this.getAll();

        return plugins.map(plugin =>
            plugin.factory(platform, accessory, managementPointId),
        );
    }

    /**
     * Create a feature filter based on config
     */
    static createConfigFilter(config: Record<string, unknown>): (plugin: FeaturePlugin) => boolean {
        return (plugin: FeaturePlugin) => {
            // If no config key specified, always include
            if (!plugin.metadata.configKey) {
                return true;
            }

            // Check if feature is enabled in config
            const configValue = config[plugin.metadata.configKey];

            // If config key exists and is false, exclude
            if (configValue === false) {
                return false;
            }

            // Otherwise include
            return true;
        };
    }
}

/**
 * Helper function to create a feature plugin
 */
export function createFeaturePlugin(
    metadata: FeatureMetadata,
    FeatureClass: new (
        platform: DaikinCloudPlatform,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        managementPointId: string,
    ) => BaseFeature,
): FeaturePlugin {
    return {
        metadata,
        factory: (platform, accessory, managementPointId) =>
            new FeatureClass(platform, accessory, managementPointId),
    };
}

/**
 * Decorator for registering features
 */
export function RegisterFeature(metadata: FeatureMetadata) {
    return function <T extends new (...args: any[]) => BaseFeature>(constructor: T) {
        const registry = FeatureRegistry.getInstance();
        registry.register(
            createFeaturePlugin(metadata, constructor as any),
        );
        return constructor;
    };
}
