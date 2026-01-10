/**
 * Service Container
 *
 * Lightweight dependency injection container for managing service instances.
 * Provides singleton and factory patterns without the complexity of a full DI framework.
 */

export type ServiceFactory<T> = () => T;
export type ServiceIdentifier<T> = string | symbol;

/**
 * Service registration options
 */
export interface ServiceOptions {
    /** If true, service is created once and reused (default: true) */
    singleton?: boolean;
}

/**
 * Lightweight service container
 */
export class ServiceContainer {
    private readonly factories = new Map<ServiceIdentifier<any>, ServiceFactory<any>>();
    private readonly instances = new Map<ServiceIdentifier<any>, any>();
    private readonly options = new Map<ServiceIdentifier<any>, ServiceOptions>();

    /**
     * Register a service factory
     */
    register<T>(
        identifier: ServiceIdentifier<T>,
        factory: ServiceFactory<T>,
        opts: ServiceOptions = {},
    ): void {
        if (this.factories.has(identifier)) {
            throw new Error(`Service '${String(identifier)}' is already registered`);
        }

        this.factories.set(identifier, factory);
        this.options.set(identifier, {singleton: true, ...opts});
    }

    /**
     * Register a singleton service
     */
    singleton<T>(identifier: ServiceIdentifier<T>, factory: ServiceFactory<T>): void {
        this.register(identifier, factory, {singleton: true});
    }

    /**
     * Register a transient service (new instance on each resolve)
     */
    transient<T>(identifier: ServiceIdentifier<T>, factory: ServiceFactory<T>): void {
        this.register(identifier, factory, {singleton: false});
    }

    /**
     * Register an existing instance
     */
    instance<T>(identifier: ServiceIdentifier<T>, instance: T): void {
        this.instances.set(identifier, instance);
        this.options.set(identifier, {singleton: true});
    }

    /**
     * Resolve a service
     */
    resolve<T>(identifier: ServiceIdentifier<T>): T {
        // Check if instance already exists
        if (this.instances.has(identifier)) {
            return this.instances.get(identifier)!;
        }

        // Get factory
        const factory = this.factories.get(identifier);
        if (!factory) {
            throw new Error(`Service '${String(identifier)}' is not registered`);
        }

        // Create instance
        const instance = factory();

        // Store if singleton
        const opts = this.options.get(identifier);
        if (opts?.singleton) {
            this.instances.set(identifier, instance);
        }

        return instance;
    }

    /**
     * Check if a service is registered
     */
    has(identifier: ServiceIdentifier<any>): boolean {
        return this.factories.has(identifier) || this.instances.has(identifier);
    }

    /**
     * Unregister a service
     */
    unregister(identifier: ServiceIdentifier<any>): void {
        this.factories.delete(identifier);
        this.instances.delete(identifier);
        this.options.delete(identifier);
    }

    /**
     * Clear all services
     */
    clear(): void {
        this.factories.clear();
        this.instances.clear();
        this.options.clear();
    }

    /**
     * Get all registered service identifiers
     */
    getRegisteredServices(): Array<ServiceIdentifier<any>> {
        return [
            ...Array.from(this.factories.keys()),
            ...Array.from(this.instances.keys()),
        ];
    }
}

/**
 * Service identifiers (type-safe keys)
 */
export const Services = {
    // Core services
    LOGGER: Symbol('Logger'),
    CONFIG_MANAGER: Symbol('ConfigManager'),
    ERROR_HANDLER: Symbol('ErrorHandler'),

    // API services
    DAIKIN_API: Symbol('DaikinApi'),
    DAIKIN_OAUTH: Symbol('DaikinOAuth'),
    DAIKIN_MOBILE_OAUTH: Symbol('DaikinMobileOAuth'),
    HTTP_CLIENT: Symbol('HttpClient'),

    // Platform services
    SERVICE_FACTORY: Symbol('ServiceFactory'),
    FEATURE_REGISTRY: Symbol('FeatureRegistry'),
    UPDATE_MAPPER: Symbol('UpdateMapper'),

    // Controller
    DAIKIN_CONTROLLER: Symbol('DaikinController'),
} as const;

/**
 * Global container instance
 */
let globalContainer: ServiceContainer | null = null;

/**
 * Get the global container
 */
export function getContainer(): ServiceContainer {
    if (!globalContainer) {
        globalContainer = new ServiceContainer();
    }
    return globalContainer;
}

/**
 * Set the global container
 */
export function setContainer(container: ServiceContainer): void {
    globalContainer = container;
}

/**
 * Reset the global container
 */
export function resetContainer(): void {
    globalContainer = null;
}

/**
 * Create a new container
 */
export function createContainer(): ServiceContainer {
    return new ServiceContainer();
}
