import type { RateLimitStore } from './storage';
import type {Middleware, RequestEvent} from "../../types";
import {MemoryStore} from "./InMemory";

export type Options = {
    /**
     * Window duration in milliseconds
     * @default 60_000 (1 minute)
     */
    windowMs?: number;

    /**
     * Max number of requests per window
     */
    max: number;

    /**
     * Function to generate key for rate limiting
     * @default IP address
     */
    key?: (event: RequestEvent) => string;

    /**
     * Custom error message (string or JSON)
     * @default "Too many requests, please try again later."
     */
    message?: string | Record<string, any>;

    /**
     * HTTP status code to return
     * @default 429
     */
    statusCode?: number;

    /**
     * Whether to add rate limit headers
     * @default 'include'
     */
    headers?: 'include' | 'remove';

    /**
     * Called when rate limit is hit
     */
    onRateLimit?: (event: RequestEvent, info: { current: number; max: number; key: string }) => void;

    /**
     * Storage backend
     * @default MemoryStore
     */
    store?: RateLimitStore;
};

/**
 * Fixed window rate limiter middleware
 */
export function fixedWindowLimit(options: Options): Middleware {
    const {
        windowMs = 60_000,
        max,
        key = (event) => event.getClientAddress(),
        message = 'Too many requests, please try again later.',
        statusCode = 429,
        headers = 'include',
        onRateLimit,
        store = new MemoryStore({ windowMs })
    } = options;

    return async (event, next) => {
        const rateLimitKey = `rl:${key(event)}`;
        const { current, reset } = await store.incr(rateLimitKey);

        const retryAfter = Math.ceil((reset - Date.now()) / 1000);

        if (current > max) {
            if (onRateLimit) {
                onRateLimit(event, { current, max, key: rateLimitKey });
            }

            const responseInit: ResponseInit = {
                status: statusCode,
                headers: new Headers()
            };

            const header = responseInit.headers! as Headers;

            if (headers === 'include') {
                header.set('X-RateLimit-Limit', String(max));
                header.set('X-RateLimit-Remaining', '0');
                header.set('X-RateLimit-Reset', String(Math.floor(reset / 1000)));
                header.set('Retry-After', String(retryAfter));
            }

            let body: string;
            if (typeof message === 'string') {
                body = message;
                header.set('Content-Type', 'text/plain');
            } else {
                body = JSON.stringify(message);
                header.set('Content-Type', 'application/json');
            }

            return new Response(body, responseInit);
        }

        // Add info to event for debugging
        (event as any).rateLimit = {
            current,
            limit: max,
            reset: new Date(reset),
            remaining: max - current
        };

        // Add headers to response if enabled
        if (headers === 'include') {
            const rateLimitHeaders = {
                'X-RateLimit-Limit': String(max),
                'X-RateLimit-Remaining': String(max - current),
                'X-RateLimit-Reset': String(Math.floor(reset / 1000))
            };
            const originalSetHeaders = event.setHeaders;
            event.setHeaders = (newHeaders) => {
                originalSetHeaders({
                    ...rateLimitHeaders,
                    ...newHeaders
                });
            };
            originalSetHeaders(rateLimitHeaders);
        }

        return next();
    };
}
