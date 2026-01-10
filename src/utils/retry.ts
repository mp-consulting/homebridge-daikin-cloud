/**
 * Retry Utility
 *
 * Provides retry logic with exponential backoff for failed operations.
 * Used by services and API calls to handle transient failures gracefully.
 */

export interface RetryOptions {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Retry a function with exponential backoff
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration options
 * @returns Promise that resolves with the function result or rejects after all retries exhausted
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *     async () => await apiClient.fetchData(),
 *     {
 *         maxRetries: 3,
 *         initialDelay: 1000,
 *         onRetry: (attempt, error) => {
 *             console.log(`Retry attempt ${attempt}: ${error.message}`);
 *         },
 *     },
 * );
 * ```
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
): Promise<T> {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        onRetry,
    } = options;

    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            if (attempt < maxRetries) {
                const delay = Math.min(
                    initialDelay * Math.pow(2, attempt),
                    maxDelay,
                );

                onRetry?.(attempt + 1, lastError);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError!;
}

/**
 * Check if an error is retryable
 *
 * @param error - The error to check
 * @returns True if the error should be retried
 */
export function isRetryableError(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        return true;
    }

    // HTTP status codes that are retryable
    if (error.response?.status) {
        const status = error.response.status;
        // 408 Request Timeout, 429 Too Many Requests, 502-504 Gateway errors
        return status === 408 || status === 429 || (status >= 502 && status <= 504);
    }

    return false;
}
