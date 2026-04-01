import {randomUUID} from "node:crypto";

import type {Middleware} from "../../types";

export interface Options {
    /**
     * Header name used for the request ID
     * @default "x-request-id"
     */
    headerName?: string;

    /**
     * Custom request ID generator
     * @default crypto.randomUUID
     */
    generate?: () => string;

    /**
     * Enable client request ID handling
     * When enabled, checks for X-Client-Request-Id header, validates it contains only ASCII characters and is no more than 512 characters,
     * and uses it if valid. Invalid headers result in a 400 error response.
     * @default false
     */
    clientRequestId?: boolean;
}

export function assign(options: Options = {}): Middleware<string, {requestId: string}> {
    const headerName = options.headerName?.toLowerCase() ?? "x-request-id";
    const generate = options.generate ?? randomUUID;
    const clientRequestId = options.clientRequestId ?? false;

    return async (event, next) => {
        let requestId = event.request.headers.get(headerName) ?? generate();

        if (clientRequestId) {
            const clientRequestIdHeader = event.request.headers.get("x-client-request-id");
            if (clientRequestIdHeader !== null) {
                if (!isAscii(clientRequestIdHeader) || clientRequestIdHeader.length > 512) {
                    return new Response("Invalid X-Client-Request-Id header", {status: 400});
                }
                requestId = clientRequestIdHeader;
            }
        }

        Object.assign(event.locals, {requestId});

        const response = await next();
        if (!response) return;

        if (response.headers.has(headerName)) {
            return response;
        }

        const headers = new Headers(response.headers);
        headers.set(headerName, requestId);

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers
        });
    };
}

function isAscii(str: string): boolean {
    return /^[\x00-\x7F]*$/.test(str);
}
