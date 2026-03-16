import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import type { RequestEvent } from "./types";

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
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".xml": "application/xml; charset=utf-8"
};

export type StaticOptions = {
    index?: string;
    cacheControl?: string;
    dotFiles?: "allow" | "deny" | "ignore";
    headers?: HeadersInit | ((filePath: string, stats: Awaited<ReturnType<typeof stat>>) => HeadersInit);
};

const DEFAULT_STATIC_OPTIONS: Required<Omit<StaticOptions, "headers">> = {
    index: "index.html",
    cacheControl: "public, max-age=0",
    dotFiles: "ignore"
};

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
        return filePath;
    }

    const fileStats = await stat(filePath);
    const headers = new Headers({
        "content-length": String(fileStats.size),
        "content-type": getMimeType(filePath),
        "cache-control": resolvedOptions.cacheControl,
        "last-modified": fileStats.mtime.toUTCString(),
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

    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>, {
        status: 200,
        headers
    });
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
