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

function createStaticEvent(path: string) {
    return {
        params: { path },
        url: new URL(`http://127.0.0.1/${path}`),
        request: new Request(`http://127.0.0.1/${path}`),
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
        server.router.GET("/assets/[...path]", dir(assetsRoot));

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
});
