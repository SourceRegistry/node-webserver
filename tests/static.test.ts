import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {dir, serveStatic} from "../src";
import { WebServer } from "../src";

const servers: WebServer[] = [];

async function startServer(server: WebServer): Promise<number> {
    servers.push(server);
    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address");
    }

    return address.port;
}

async function createTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "node-webserver-static-"));
}

function createStaticEvent(path: string, requestInit?: RequestInit) {
    return {
        params: { path },
        url: new URL(`http://127.0.0.1/${path}`),
        request: new Request(`http://127.0.0.1/${path}`, requestInit),
        cookies: {} as any,
        locals: {},
        platform: undefined,
        route: { id: "" },
        getClientAddress: () => "127.0.0.1",
        setHeaders: () => {}
    } as any;
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
    })));
});

describe("static file helper", () => {
    it("serves a file from the configured root", async () => {
        const root = await createTempDir();
        const assetsRoot = join(root, "assets");
        await mkdir(assetsRoot);
        await writeFile(join(assetsRoot, "app.js"), "console.log('ok');");

        const server = new WebServer();
        server.GET("/assets/[...path]", dir(assetsRoot));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/assets/app.js`);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/javascript");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await response.text()).toBe("console.log('ok');");
    });

    it("serves the directory index by default", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "index.html"), "<h1>ok</h1>");

        const response = await serveStatic(root, createStaticEvent(""));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("<h1>ok</h1>");
    });

    it("rejects direct path traversal attempts", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "index.html"), "<h1>ok</h1>");

        const response = await serveStatic(root, createStaticEvent("../secret.txt"));

        expect(response.status).toBe(403);
    });

    it("rejects encoded path traversal attempts", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "index.html"), "<h1>ok</h1>");

        const response = await serveStatic(root, createStaticEvent("..%2fsecret.txt"));

        expect(response.status).toBe(403);
    });

    it("rejects dotfiles by default", async () => {
        const root = await createTempDir();
        await writeFile(join(root, ".env"), "secret");

        const response = await serveStatic(root, createStaticEvent(".env"));

        expect(response.status).toBe(404);
    });

    it("rejects symlink escapes outside the root", async () => {
        const root = await createTempDir();
        const outside = await createTempDir();
        await writeFile(join(outside, "secret.txt"), "secret");

        try {
            await symlink(join(outside, "secret.txt"), join(root, "public-link.txt"));
        } catch (error: any) {
            if (error?.code === "EPERM" || error?.code === "EACCES") {
                return;
            }
            throw error;
        }

        const response = await serveStatic(root, createStaticEvent("public-link.txt"));

        expect(response.status).toBe(403);
    });

    it("includes etag and last-modified headers on 200 responses", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const response = await serveStatic(root, createStaticEvent("app.js"));

        expect(response.status).toBe(200);
        expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]+-[a-f0-9]+"$/);
        expect(response.headers.get("last-modified")).toBeTruthy();
    });

    it("returns 304 when if-none-match matches the etag", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const first = await serveStatic(root, createStaticEvent("app.js"));
        const etag = first.headers.get("etag")!;

        const second = await serveStatic(root, createStaticEvent("app.js", {
            headers: { "if-none-match": etag }
        }));

        expect(second.status).toBe(304);
        expect(await second.text()).toBe("");
    });

    it("returns 304 when if-none-match is wildcard", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const response = await serveStatic(root, createStaticEvent("app.js", {
            headers: { "if-none-match": "*" }
        }));

        expect(response.status).toBe(304);
    });

    it("returns 200 when if-none-match does not match", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const response = await serveStatic(root, createStaticEvent("app.js", {
            headers: { "if-none-match": '"stale-etag"' }
        }));

        expect(response.status).toBe(200);
    });

    it("returns 304 when if-modified-since is at or after mtime", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const first = await serveStatic(root, createStaticEvent("app.js"));
        const lastModified = first.headers.get("last-modified")!;

        const second = await serveStatic(root, createStaticEvent("app.js", {
            headers: { "if-modified-since": lastModified }
        }));

        expect(second.status).toBe(304);
    });

    it("returns 200 when if-modified-since is before mtime", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const past = new Date(Date.now() - 60_000).toUTCString();
        const response = await serveStatic(root, createStaticEvent("app.js", {
            headers: { "if-modified-since": past }
        }));

        expect(response.status).toBe(200);
    });

    it("prefers if-none-match over if-modified-since", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const past = new Date(Date.now() - 60_000).toUTCString();
        const response = await serveStatic(root, createStaticEvent("app.js", {
            headers: {
                "if-none-match": '"stale-etag"',
                "if-modified-since": new Date(Date.now() + 60_000).toUTCString()
            }
        }));

        expect(response.status).toBe(200);
    });

    it("strips the body for 304 responses at the server level", async () => {
        const server = new WebServer();
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");
        server.GET("/assets/[...path]", dir(root));

        const port = await startServer(server);
        const first = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
        const etag = first.headers.get("etag")!;

        const second = await fetch(`http://127.0.0.1:${port}/assets/app.js`, {
            headers: { "if-none-match": etag }
        });

        expect(second.status).toBe(304);
        expect(await second.text()).toBe("");
    });

    it("serves dotfiles when dotFiles is allow", async () => {
        const root = await createTempDir();
        await writeFile(join(root, ".env"), "secret");

        const response = await serveStatic(root, createStaticEvent(".env"), { dotFiles: "allow" });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("secret");
    });

    it("returns 403 for dotfiles when dotFiles is deny", async () => {
        const root = await createTempDir();
        await writeFile(join(root, ".env"), "secret");

        const response = await serveStatic(root, createStaticEvent(".env"), { dotFiles: "deny" });

        expect(response.status).toBe(403);
    });

    it("applies a custom cache-control value", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const response = await serveStatic(root, createStaticEvent("app.js"), {
            cacheControl: "public, max-age=3600"
        });

        expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("merges static extra headers onto the response", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const response = await serveStatic(root, createStaticEvent("app.js"), {
            headers: { "x-custom": "yes" }
        });

        expect(response.headers.get("x-custom")).toBe("yes");
    });

    it("merges function-based extra headers onto the response", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const response = await serveStatic(root, createStaticEvent("app.js"), {
            headers: (filePath) => ({ "x-file": filePath.endsWith(".js") ? "js" : "other" })
        });

        expect(response.headers.get("x-file")).toBe("js");
    });

    it("recognizes woff2 font MIME type", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "font.woff2"), "binary");

        const response = await serveStatic(root, createStaticEvent("font.woff2"));

        expect(response.headers.get("content-type")).toBe("font/woff2");
    });

    it("includes accept-ranges header on 200 responses", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "app.js"), "console.log('ok');");

        const response = await serveStatic(root, createStaticEvent("app.js"));

        expect(response.headers.get("accept-ranges")).toBe("bytes");
    });
});

describe("static file helper — range requests", () => {
    it("serves a partial range with 206", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "data.txt"), "0123456789");

        const response = await serveStatic(root, createStaticEvent("data.txt", {
            headers: { "range": "bytes=0-4" }
        }));

        expect(response.status).toBe(206);
        expect(response.headers.get("content-range")).toBe("bytes 0-4/10");
        expect(response.headers.get("content-length")).toBe("5");
        expect(await response.text()).toBe("01234");
    });

    it("serves an open-ended range", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "data.txt"), "0123456789");

        const response = await serveStatic(root, createStaticEvent("data.txt", {
            headers: { "range": "bytes=5-" }
        }));

        expect(response.status).toBe(206);
        expect(response.headers.get("content-range")).toBe("bytes 5-9/10");
        expect(await response.text()).toBe("56789");
    });

    it("serves a suffix range", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "data.txt"), "0123456789");

        const response = await serveStatic(root, createStaticEvent("data.txt", {
            headers: { "range": "bytes=-3" }
        }));

        expect(response.status).toBe(206);
        expect(response.headers.get("content-range")).toBe("bytes 7-9/10");
        expect(await response.text()).toBe("789");
    });

    it("returns 416 for out-of-bounds range", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "data.txt"), "0123456789");

        const response = await serveStatic(root, createStaticEvent("data.txt", {
            headers: { "range": "bytes=5-100" }
        }));

        expect(response.status).toBe(416);
        expect(response.headers.get("content-range")).toBe("bytes */10");
    });

    it("returns 416 for reversed range", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "data.txt"), "0123456789");

        const response = await serveStatic(root, createStaticEvent("data.txt", {
            headers: { "range": "bytes=5-2" }
        }));

        expect(response.status).toBe(416);
    });

    it("returns 304 for conditional range request when not modified", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "data.txt"), "0123456789");

        const first = await serveStatic(root, createStaticEvent("data.txt"));
        const etag = first.headers.get("etag")!;

        const second = await serveStatic(root, createStaticEvent("data.txt", {
            headers: { "if-none-match": etag, "range": "bytes=0-4" }
        }));

        expect(second.status).toBe(304);
    });
});

describe("static file helper — SPA fallback", () => {
    it("serves index.html for unknown paths with no extension when spa is true", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "index.html"), "<app />");

        const response = await serveStatic(root, createStaticEvent("dashboard/settings"), { spa: true });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("<app />");
    });

    it("still returns 404 for unknown paths with an extension", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "index.html"), "<app />");

        const response = await serveStatic(root, createStaticEvent("missing.png"), { spa: true });

        expect(response.status).toBe(404);
    });

    it("does not trigger SPA fallback when spa is false", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "index.html"), "<app />");

        const response = await serveStatic(root, createStaticEvent("dashboard"), { spa: false });

        expect(response.status).toBe(404);
    });

    it("serves the real file when it exists even with spa enabled", async () => {
        const root = await createTempDir();
        await writeFile(join(root, "index.html"), "<app />");
        await writeFile(join(root, "about.html"), "<about />");

        const response = await serveStatic(root, createStaticEvent("about.html"), { spa: true });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("<about />");
    });
});
