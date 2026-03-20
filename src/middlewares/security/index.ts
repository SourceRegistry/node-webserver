import type {Middleware} from "../../types";

export interface Options {
    /**
     * Content Security Policy header value
     * @default "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
     */
    contentSecurityPolicy?: string | false;

    /**
     * X-Frame-Options header value
     * @default "DENY"
     */
    frameOptions?: "DENY" | "SAMEORIGIN" | false;

    /**
     * Referrer-Policy header value
     * @default "no-referrer"
     */
    referrerPolicy?: string | false;

    /**
     * Permissions-Policy header value
     * @default "geolocation=(), microphone=(), camera=()"
     */
    permissionsPolicy?: string | false;

    /**
     * Cross-Origin-Opener-Policy header value
     * @default "same-origin"
     */
    crossOriginOpenerPolicy?: string | false;

    /**
     * Cross-Origin-Resource-Policy header value
     * @default "same-origin"
     */
    crossOriginResourcePolicy?: string | false;

    /**
     * Strict-Transport-Security header value
     * @default false
     */
    strictTransportSecurity?: string | false;
}

const DEFAULT_HEADERS: Required<Options> = {
    contentSecurityPolicy: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
    frameOptions: "DENY",
    referrerPolicy: "no-referrer",
    permissionsPolicy: "geolocation=(), microphone=(), camera=()",
    crossOriginOpenerPolicy: "same-origin",
    crossOriginResourcePolicy: "same-origin",
    strictTransportSecurity: false
};

export function headers(options: Options = {}): Middleware {
    const resolved = {
        ...DEFAULT_HEADERS,
        ...options
    };

    return async (_event, next) => {
        const response = await next();
        if (!response) return;

        const headers = new Headers(response.headers);

        setHeaderIfMissing(headers, "content-security-policy", resolved.contentSecurityPolicy);
        setHeaderIfMissing(headers, "x-frame-options", resolved.frameOptions);
        setHeaderIfMissing(headers, "referrer-policy", resolved.referrerPolicy);
        setHeaderIfMissing(headers, "permissions-policy", resolved.permissionsPolicy);
        setHeaderIfMissing(headers, "cross-origin-opener-policy", resolved.crossOriginOpenerPolicy);
        setHeaderIfMissing(headers, "cross-origin-resource-policy", resolved.crossOriginResourcePolicy);
        setHeaderIfMissing(headers, "strict-transport-security", resolved.strictTransportSecurity);

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    };
}

function setHeaderIfMissing(headers: Headers, name: string, value: string | false): void {
    if (!value || headers.has(name)) return;
    headers.set(name, value);
}
