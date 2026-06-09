import { createBrotliCompress, createGzip } from "node:zlib";
import { Readable } from "node:stream";

import type { Middleware } from "../../types";

export type CompressionOptions = {
    threshold?: number;
    br?: boolean;
    gzip?: boolean;
};

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded)|image\/svg)/;

function isCompressible(contentType: string): boolean {
    return COMPRESSIBLE.test(contentType.split(";")[0].trim());
}

function selectEncoding(acceptEncoding: string, br: boolean, gzip: boolean): "br" | "gzip" | null {
    if (br && /\bbr\b/.test(acceptEncoding)) return "br";
    if (gzip && /\bgzip\b/.test(acceptEncoding)) return "gzip";
    return null;
}

export function compress(options: CompressionOptions = {}): Middleware {
    const threshold = options.threshold ?? 1024;
    const br = options.br ?? true;
    const gzip = options.gzip ?? true;

    return async (event, next) => {
        const response = await next();
        if (!response || !response.body) return response;
        if (response.status === 204 || response.status === 304) return response;
        if (response.headers.has("content-encoding")) return response;

        const contentType = response.headers.get("content-type") ?? "";
        if (!isCompressible(contentType)) return response;

        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) < threshold) return response;

        const acceptEncoding = event.request.headers.get("accept-encoding") ?? "";
        const encoding = selectEncoding(acceptEncoding, br, gzip);
        if (!encoding) return response;

        const compressor = encoding === "br" ? createBrotliCompress() : createGzip();
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(compressor);

        const headers = new Headers(response.headers);
        headers.set("content-encoding", encoding);
        headers.delete("content-length");
        const vary = headers.get("vary");
        headers.set("vary", vary ? `${vary}, accept-encoding` : "accept-encoding");

        return new Response(
            Readable.toWeb(compressor) as ReadableStream<Uint8Array>,
            { status: response.status, statusText: response.statusText, headers }
        );
    };
}
