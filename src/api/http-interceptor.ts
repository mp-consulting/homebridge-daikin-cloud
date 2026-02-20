/**
 * HTTP Interceptor Pattern
 *
 * Provides a clean separation of concerns for request/response handling,
 * including rate limiting, retry logic, and error handling.
 */

import {HTTP_STATUS} from '../constants';

export interface HttpRequest {
    url: string;
    method: 'GET' | 'PATCH' | 'POST' | 'DELETE';
    headers: Record<string, string>;
    body?: string;
}

export interface HttpResponse {
    statusCode: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
}

export interface Interceptor {
    /**
     * Called before making the request
     * Can modify the request or throw to prevent it
     */
    beforeRequest?(request: HttpRequest): Promise<HttpRequest> | HttpRequest;

    /**
     * Called after receiving the response
     * Can modify the response or throw to handle errors
     */
    afterResponse?(response: HttpResponse, request: HttpRequest): Promise<HttpResponse> | HttpResponse;

    /**
     * Called when an error occurs
     * Can handle the error or re-throw
     */
    onError?(error: Error, request: HttpRequest): Promise<never> | never;
}

/**
 * HTTP Client with interceptor support
 */
export class HttpClient {
    private interceptors: Interceptor[] = [];

    /**
     * Add an interceptor
     */
    use(interceptor: Interceptor): void {
        this.interceptors.push(interceptor);
    }

    /**
     * Execute request with all interceptors
     */
    async execute(
        request: HttpRequest,
        executor: (req: HttpRequest) => Promise<HttpResponse>,
    ): Promise<HttpResponse> {
        try {
            // Apply beforeRequest interceptors
            let processedRequest = request;
            for (const interceptor of this.interceptors) {
                if (interceptor.beforeRequest) {
                    processedRequest = await interceptor.beforeRequest(processedRequest);
                }
            }

            // Execute the actual request
            let response = await executor(processedRequest);

            // Apply afterResponse interceptors
            for (const interceptor of this.interceptors) {
                if (interceptor.afterResponse) {
                    response = await interceptor.afterResponse(response, processedRequest);
                }
            }

            return response;
        } catch (error) {
            // Apply error interceptors
            for (const interceptor of this.interceptors) {
                if (interceptor.onError) {
                    await interceptor.onError(error as Error, request);
                }
            }
            throw error;
        }
    }
}

/**
 * Rate Limit Interceptor
 */
export class RateLimitInterceptor implements Interceptor {
    private blockedUntil = 0;

    constructor(
        private readonly maxBlockSeconds: number,
        private readonly msPerSecond: number,
    ) {}

    beforeRequest(request: HttpRequest): HttpRequest {
        if (this.isBlocked()) {
            const retryAfter = this.getRetryAfter();
            throw new RateLimitError(
                `API request blocked due to rate limit. Retry after ${retryAfter} seconds.`,
                retryAfter,
            );
        }
        return request;
    }

    afterResponse(response: HttpResponse): HttpResponse {
        if (response.statusCode === HTTP_STATUS.TOO_MANY_REQUESTS) {
            const retryAfter = this.parseRetryAfter(response.headers['retry-after']);
            const blockedFor = Math.min(retryAfter, this.maxBlockSeconds);
            this.blockedUntil = Date.now() + blockedFor * this.msPerSecond;
            throw new RateLimitError(
                `Rate limited. Retry after ${retryAfter} seconds.`,
                blockedFor,
            );
        }
        return response;
    }

    private isBlocked(): boolean {
        return this.blockedUntil > Date.now();
    }

    private getRetryAfter(): number {
        return Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / this.msPerSecond));
    }

    private parseRetryAfter(value: string | string[] | undefined): number {
        if (!value) {
            return 60;
        } // Default 60 seconds
        const str = Array.isArray(value) ? value[0] : value;
        const num = parseInt(str, 10);
        return isNaN(num) ? 60 : num;
    }

    /**
     * Check if currently rate limited
     */
    isRateLimited(): boolean {
        return this.isBlocked();
    }

    /**
     * Get time until rate limit is lifted
     */
    getRateLimitRetryAfter(): number {
        return this.getRetryAfter();
    }
}

/**
 * Retry Interceptor for transient errors
 */
export class RetryInterceptor implements Interceptor {
    private attemptCount = new Map<HttpRequest, number>();

    constructor(
        private readonly maxAttempts: number,
        private readonly baseDelayMs: number,
        private readonly maxDelayMs: number,
        private readonly retryableStatusCodes: number[],
    ) {}

    async afterResponse(response: HttpResponse, request: HttpRequest): Promise<HttpResponse> {
        if (this.shouldRetry(response)) {
            const attempts = this.getAttempts(request);
            if (attempts < this.maxAttempts) {
                this.incrementAttempts(request);
                const delay = this.calculateDelay(attempts);
                await this.sleep(delay);
                throw new RetryableError('Retrying request', response.statusCode);
            }
        }
        return response;
    }

    private shouldRetry(response: HttpResponse): boolean {
        return this.retryableStatusCodes.includes(response.statusCode);
    }

    private getAttempts(request: HttpRequest): number {
        return this.attemptCount.get(request) || 0;
    }

    private incrementAttempts(request: HttpRequest): void {
        this.attemptCount.set(request, this.getAttempts(request) + 1);
    }

    private calculateDelay(attempt: number): number {
        const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * this.baseDelayMs;
        return Math.min(exponentialDelay + jitter, this.maxDelayMs);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Custom Error Classes
 */
export class RateLimitError extends Error {
    constructor(
        message: string,
        public readonly retryAfter: number,
    ) {
        super(message);
        this.name = 'RateLimitError';
    }
}

export class RetryableError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = 'RetryableError';
    }
}
