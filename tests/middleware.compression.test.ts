import { request as httpRequest } from "node:http";
import { gunzip, brotliDecompress } from "node:zlib";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { json, text, WebServer } from "../src";
import { Compression } from "../src/middlewares";
import { useServerLifecycle } from "./test-helpers";

const gunzipAsync = promisify(gunzip);
const brotliDecompressAsync = promisify(brotliDecompress);

const { startServer } = useServerLifecycle();

async function rawFetch(port: number, path: string, headers: Record<string, string> = {}): Promise<{
    status: number;
    headers: Record<string, string | string[]>;
    body: Buffer;
}> {
    return new Promise((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET", headers }, async (res) => {
            const chunks: Buffer[] = [];
            for await (const chunk of res) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            resolve({
                status: res.statusCode ?? 200,
                headers: res.headers as Record<string, string | string[]>,
                body: Buffer.concat(chunks)
            });
        });
        req.on("error", reject);
        req.end();
    });
}

describe("compression middleware", () => {
    it("compresses text responses with gzip when accepted", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress());
        server.GET("/", () => text("hello world".repeat(200)));

        const port = await startServer(server);
        const res = await rawFetch(port, "/", { "accept-encoding": "gzip" });

        expect(res.headers["content-encoding"]).toBe("gzip");
        const decompressed = await gunzipAsync(res.body);
        expect(decompressed.toString()).toBe("hello world".repeat(200));
    });

    it("compresses text responses with brotli when accepted", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress());
        server.GET("/", () => text("hello world".repeat(200)));

        const port = await startServer(server);
        const res = await rawFetch(port, "/", { "accept-encoding": "br" });

        expect(res.headers["content-encoding"]).toBe("br");
        const decompressed = await brotliDecompressAsync(res.body);
        expect(decompressed.toString()).toBe("hello world".repeat(200));
    });

    it("prefers brotli over gzip when both accepted", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress());
        server.GET("/", () => text("hello world".repeat(200)));

        const port = await startServer(server);
        const res = await rawFetch(port, "/", { "accept-encoding": "gzip, br" });

        expect(res.headers["content-encoding"]).toBe("br");
    });

    it("skips compression when no accept-encoding sent", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress());
        server.GET("/", () => text("hello world".repeat(200)));

        const port = await startServer(server);
        const res = await rawFetch(port, "/");

        expect(res.headers["content-encoding"]).toBeUndefined();
        expect(res.body.toString()).toBe("hello world".repeat(200));
    });

    it("skips compression for non-compressible content types", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress());
        server.GET("/", () => new Response(new Uint8Array(2000), {
            headers: { "content-type": "image/png" }
        }));

        const port = await startServer(server);
        const res = await rawFetch(port, "/", { "accept-encoding": "gzip" });

        expect(res.headers["content-encoding"]).toBeUndefined();
    });

    it("skips compression below the size threshold", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress({ threshold: 10000 }));
        server.GET("/", () => text("short"));

        const port = await startServer(server);
        const res = await rawFetch(port, "/", { "accept-encoding": "gzip" });

        expect(res.headers["content-encoding"]).toBeUndefined();
        expect(res.body.toString()).toBe("short");
    });

    it("does not double-compress already encoded responses", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress());
        server.GET("/", async () => {
            const content = "data".repeat(500);
            const compressed = await new Promise<Buffer>((resolve, reject) => {
                const zlib = require("node:zlib");
                zlib.gzip(content, (err: Error | null, buf: Buffer) => err ? reject(err) : resolve(buf));
            });
            return new Response(compressed, {
                headers: {
                    "content-type": "text/plain",
                    "content-encoding": "gzip",
                    "content-length": String(compressed.length)
                }
            });
        });

        const port = await startServer(server);
        const res = await rawFetch(port, "/", { "accept-encoding": "gzip" });

        expect(res.headers["content-encoding"]).toBe("gzip");
        const decompressed = await gunzipAsync(res.body);
        expect(decompressed.toString()).toBe("data".repeat(500));
    });

    it("removes content-length and sets vary header on compressed response", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress());
        server.GET("/", () => text("hello world".repeat(200)));

        const port = await startServer(server);
        const res = await rawFetch(port, "/", { "accept-encoding": "gzip" });

        expect(res.headers["content-length"]).toBeUndefined();
        expect(String(res.headers["vary"] ?? "")).toContain("accept-encoding");
    });

    it("compresses json responses", async () => {
        const server = new WebServer();
        server.useMiddleware(Compression.compress());
        server.GET("/", () => json({ data: "x".repeat(2000) }));

        const port = await startServer(server);
        const res = await rawFetch(port, "/", { "accept-encoding": "gzip" });

        expect(res.headers["content-encoding"]).toBe("gzip");
        const decompressed = await gunzipAsync(res.body);
        expect(JSON.parse(decompressed.toString())).toEqual({ data: "x".repeat(2000) });
    });
});
