import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import type {RequestEvent, RouteHandler} from "../types";

const MIME_TYPES: Record<string, string> = {
    ".avif": "image/avif",
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".otf": "font/otf",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8"
};

export type StaticOptions = {
    index?: string;
    cacheControl?: string;
    dotFiles?: "allow" | "deny" | "ignore";
    spa?: boolean;
    headers?: HeadersInit | ((filePath: string, stats: Awaited<ReturnType<typeof stat>>) => HeadersInit);
};

const DEFAULT_STATIC_OPTIONS: Required<Omit<StaticOptions, "headers">> = {
    index: "index.html",
    cacheControl: "public, max-age=0",
    dotFiles: "ignore",
    spa: false
};

function generateETag(fileStats: Awaited<ReturnType<typeof stat>>): string {
    return `"${fileStats.size.toString(16)}-${fileStats.mtime.getTime().toString(16)}"`;
}

function isNotModified(request: Request, etag: string, mtime: Date): boolean {
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch) {
        return ifNoneMatch === etag || ifNoneMatch === "*";
    }
    const ifModifiedSince = request.headers.get("if-modified-since");
    if (ifModifiedSince) {
        return Math.floor(mtime.getTime() / 1000) <= Math.floor(new Date(ifModifiedSince).getTime() / 1000);
    }
    return false;
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) return null;

    let start: number;
    let end: number;

    if (!match[1] && !match[2]) return null;

    if (!match[1]) {
        const suffix = parseInt(match[2], 10);
        if (isNaN(suffix) || suffix === 0) return null;
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else if (!match[2]) {
        start = parseInt(match[1], 10);
        end = size - 1;
    } else {
        start = parseInt(match[1], 10);
        end = parseInt(match[2], 10);
    }

    if (isNaN(start) || isNaN(end) || start < 0 || start > end || end >= size) return null;
    return { start, end };
}

async function buildFileResponse(
    filePath: string,
    request: Request,
    options: StaticOptions,
    resolvedOptions: Required<Omit<StaticOptions, "headers">>
): Promise<Response> {
    const fileStats = await stat(filePath);
    const etag = generateETag(fileStats);
    const headers = new Headers({
        "content-type": getMimeType(filePath),
        "cache-control": resolvedOptions.cacheControl,
        "last-modified": fileStats.mtime.toUTCString(),
        "etag": etag,
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff"
    });

    if (options.headers) {
        const extraHeaders = typeof options.headers === "function"
            ? options.headers(filePath, fileStats)
            : options.headers;
        new Headers(extraHeaders).forEach((value, key) => {
            headers.set(key, value);
        });
    }

    if (isNotModified(request, etag, fileStats.mtime)) {
        return new Response(null, { status: 304, headers });
    }

    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
        const range = parseRange(rangeHeader, fileStats.size);
        if (!range) {
            return new Response(null, {
                status: 416,
                headers: { "content-range": `bytes */${fileStats.size}` }
            });
        }
        const rangeHeaders = new Headers(headers);
        rangeHeaders.set("content-length", String(range.end - range.start + 1));
        rangeHeaders.set("content-range", `bytes ${range.start}-${range.end}/${fileStats.size}`);
        return new Response(
            Readable.toWeb(createReadStream(filePath, { start: range.start, end: range.end })) as ReadableStream<Uint8Array>,
            { status: 206, headers: rangeHeaders }
        );
    }

    headers.set("content-length", String(fileStats.size));
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>, {
        status: 200,
        headers
    });
}

export async function serveStatic(root: string, event: RequestEvent, options: StaticOptions = {}): Promise<Response> {
    const requestPath = getStaticRequestPath(event);
    const resolvedOptions = {
        ...DEFAULT_STATIC_OPTIONS,
        ...options
    };

    const rootPath = await resolveStaticRoot(root);
    const normalizedPath = normalizeStaticRequestPath(requestPath, resolvedOptions.dotFiles);
    if (normalizedPath instanceof Response) {
        return normalizedPath;
    }

    const targetPath = normalizedPath.length > 0 ? normalizedPath.join(sep) : "";
    const candidatePath = resolve(rootPath, targetPath);

    if (!isPathInside(rootPath, candidatePath)) {
        return new Response("Forbidden", { status: 403 });
    }

    const filePath = await resolveStaticFile(candidatePath, rootPath, resolvedOptions.index);
    if (filePath instanceof Response) {
        if (resolvedOptions.spa && filePath.status === 404 && !extname(targetPath)) {
            const spaPath = await resolveStaticFile(rootPath, rootPath, resolvedOptions.index);
            if (!(spaPath instanceof Response)) {
                return buildFileResponse(spaPath, event.request, options, resolvedOptions);
            }
        }
        return filePath;
    }

    return buildFileResponse(filePath, event.request, options, resolvedOptions);
}

async function resolveStaticRoot(root: string): Promise<string> {
    return realpath(root);
}

function normalizeStaticRequestPath(requestPath: string, dotFiles: StaticOptions["dotFiles"]): string[] | Response {
    if (requestPath.includes("\0")) {
        return new Response("Bad Request", { status: 400 });
    }

    const segments = requestPath
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean);

    const normalizedSegments: string[] = [];

    for (const segment of segments) {
        let decoded: string;
        try {
            decoded = decodeURIComponent(segment);
        } catch {
            return new Response("Bad Request", { status: 400 });
        }

        if (!decoded || decoded === ".") {
            continue;
        }

        if (decoded === ".." || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
            return new Response("Forbidden", { status: 403 });
        }

        if (decoded.startsWith(".")) {
            if (dotFiles === "deny") {
                return new Response("Forbidden", { status: 403 });
            }
            if (dotFiles !== "allow") {
                return new Response("Not Found", { status: 404 });
            }
        }

        normalizedSegments.push(decoded);
    }

    return normalizedSegments;
}

async function resolveStaticFile(candidatePath: string, rootPath: string, indexFile: string): Promise<string | Response> {
    try {
        const candidateStats = await lstat(candidatePath);

        if (candidateStats.isDirectory()) {
            const indexPath = resolve(candidatePath, indexFile);
            return ensureResolvedFile(indexPath, rootPath);
        }

        return ensureResolvedFile(candidatePath, rootPath);
    } catch {
        return new Response("Not Found", { status: 404 });
    }
}

async function ensureResolvedFile(candidatePath: string, rootPath: string): Promise<string | Response> {
    try {
        const resolvedPath = await realpath(candidatePath);
        if (!isPathInside(rootPath, resolvedPath)) {
            return new Response("Forbidden", { status: 403 });
        }

        const resolvedStats = await stat(resolvedPath);
        if (!resolvedStats.isFile()) {
            return new Response("Not Found", { status: 404 });
        }

        return resolvedPath;
    } catch {
        return new Response("Not Found", { status: 404 });
    }
}

function isPathInside(rootPath: string, targetPath: string): boolean {
    const relativePath = relative(rootPath, targetPath);
    return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function getMimeType(filePath: string): string {
    return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function getStaticRequestPath(event: RequestEvent): string {
    if (typeof event.params.path === "string") {
        return event.params.path;
    }

    return event.url.pathname.replace(/^\/+/, "");
}


export default <Path extends string>(root: string, options: StaticOptions = {}): RouteHandler<Path> =>
    (event) => serveStatic(root, event, options);
