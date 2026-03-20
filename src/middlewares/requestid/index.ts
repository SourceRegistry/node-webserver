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
}

export function assign(options: Options = {}): Middleware<string, {requestId: string}> {
    const headerName = options.headerName?.toLowerCase() ?? "x-request-id";
    const generate = options.generate ?? randomUUID;

    return async (event, next) => {
        const requestId = event.request.headers.get(headerName) ?? generate();
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
