import {Middleware} from "../../types";

/**
 * Configuration for CORS middleware
 */
export interface Options {
    /**
     * Allowed origins (strings or regex)
     * @default '*' (allow all)
     */
    origin?: string | string[] | RegExp | RegExp[] | ((origin: string) => boolean);

    /**
     * Allowed methods
     * @default ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
     */
    methods?: string[];

    /**
     * Allowed request headers
     * @default 'Content-Type,X-Auth-Token,Authorization' (plus simple headers)
     */
    allowedHeaders?: string[];

    /**
     * Exposed headers in response
     */
    exposedHeaders?: string[];

    /**
     * Whether to include credentials (cookies, authorization)
     * @default false
     */
    credentials?: boolean;

    /**
     * Max age of preflight result (in seconds)
     * @default 86400 (24h)
     */
    maxAge?: number;

    /**
     * Optional callback to modify response before sending
     */
    onResponse?: (response: Response) => void | Response;
}

/**
 * Default allowed methods
 */
const DEFAULT_METHODS = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'HEAD',
    'OPTIONS'
];

/**
 * Default simple headers (always allowed by browsers)
 */
const SIMPLE_HEADERS = [
    'Accept',
    'Accept-Language',
    'Content-Language',
    'Content-Type',
    'Range'
];

/**
 * Default allowed headers beyond simple headers
 */
const DEFAULT_ALLOWED_HEADERS = [
    'Authorization',
    'X-Auth-Token',
    'X-Requested-With',
    'X-CSRF-Token',
    'X-HTTP-Method-Override',
    'X-Forwarded-For',
    'X-Real-IP',
    'X-Custom-Header'
];

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string, option: Options['origin']): boolean {
    if (!origin || !option) return false;

    if (option === '*') return true;
    if (option === 'null') return origin === 'null';

    if (Array.isArray(option)) {
        return option.some(o => isOriginAllowed(origin, o));
    }

    if (typeof option === 'function') {
        return option(origin);
    }

    if (option instanceof RegExp) {
        return option.test(origin);
    }

    return origin === option;
}

/**
 * Get allowed origin header value
 */
function getAllowedOrigin(requestOrigin: string | null, options: Options): string | null {
    const { origin = '*' } = options;

    if (!requestOrigin) return origin === '*' ? '*' : null;

    if (origin === '*') {
        // If wildcard, reflect the origin (but not for credentials)
        return options.credentials ? requestOrigin : '*';
    }

    if (isOriginAllowed(requestOrigin, origin)) {
        return requestOrigin; // Reflect allowed origin
    }

    return null;
}

/**
 * CORS Middleware Factory
 *
 * @example
 * // Allow all (default)
 * cors()
 *
 * @example
 * // Allow specific origin
 * cors({ origin: 'https://myapp.com' })
 *
 * @example
 * // Allow multiple origins
 * cors({ origin: ['https://myapp.com', 'https://admin.com'] })
 *
 * @example
 * // Allow with regex
 * cors({ origin: /^https:\/\/.*\.mycompany\.com$/ })
 *
 * @example
 * // Allow with credentials
 * cors({
 *   origin: 'https://myapp.com',
 *   credentials: true
 * })
 */
export function policy(options: Options = {}): Middleware {
    const {
        methods = DEFAULT_METHODS,
        allowedHeaders = DEFAULT_ALLOWED_HEADERS,
        exposedHeaders,
        credentials = false,
        maxAge = 86400,
        onResponse
    } = options;

    const varyHeader = 'Origin,Access-Control-Request-Method,Access-Control-Request-Headers';
    const methodsHeader = methods.join(',');
    const allowedHeadersHeader = [...SIMPLE_HEADERS, ...allowedHeaders].join(',');

    const headersToSet: [string, string][] = [
        ['Vary', varyHeader],
        ['Access-Control-Allow-Methods', methodsHeader],
        ['Access-Control-Allow-Headers', allowedHeadersHeader],
    ];

    if (exposedHeaders) {
        headersToSet.push(['Access-Control-Expose-Headers', exposedHeaders.join(',')])
    }

    if (credentials) {
        headersToSet.push(['Access-Control-Allow-Credentials', 'true']);
    }

    if (maxAge) {
        headersToSet.push(['Access-Control-Max-Age', maxAge.toString()]);
    }

    return async (event, next) => {
        const request = event.request;
        const origin = request.headers.get('Origin');
        const isPreflight = request.method === 'OPTIONS'
            && origin !== null
            && request.headers.has('Access-Control-Request-Method');

        const allowedOrigin = getAllowedOrigin(origin, options);
        if (isPreflight) {
            if (!allowedOrigin) {
                return new Response(null, {status: 403});
            }

            const preflightResponse = new Response(null, {status: 204});
            for (const [key, value] of headersToSet) {
                preflightResponse.headers.set(key, value);
            }
            preflightResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);
            return preflightResponse;
        }

        // Always set Vary and other base headers
        const response = await next();

        if (!response) return;

        // Check if origin is allowed
        if (!allowedOrigin) return response;

        // Clone response so we can modify headers
        const modifiedResponse = new Response(response.body, response);

        // Set CORS headers
        for (const [key, value] of headersToSet) {
            modifiedResponse.headers.set(key, value);
        }
        modifiedResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);

        // Allow response to be modified
        let finalResponse = modifiedResponse;
        if (onResponse) {
            const override = onResponse(finalResponse);
            if (override) finalResponse = override;
        }

        return finalResponse;
    };
}
