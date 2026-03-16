import {request as httpRequest} from "node:http";
import {afterEach, describe, expect, it} from "vitest";
import {WebSocket} from "ws";

import {CORS} from "../src/middlewares";
import {fixedWindowLimit} from "../src/middlewares/ratelimiter";
import {Router, WebServer, text} from "../src";

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

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
    })));
});

describe("server hardening", () => {
    it("uses byte length for helper responses", async () => {
        const response = await text("€");

        expect(response.headers.get("content-length")).toBe("3");
    });

    it("does not trust Host by default when building event URLs", async () => {
        const server = new WebServer();
        server.router.GET("/", (event) => new Response(event.url.host));

        const port = await startServer(server);
        const body = await new Promise<string>((resolve, reject) => {
            const req = httpRequest({
                host: "127.0.0.1",
                port,
                path: "/",
                method: "GET",
                headers: {
                    Host: "evil.example"
                }
            }, async (res) => {
                const chunks: Buffer[] = [];
                for await (const chunk of res) {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                }
                resolve(Buffer.concat(chunks).toString("utf8"));
            });

            req.on("error", reject);
            req.end();
        });

        expect(body).toBe(`127.0.0.1:${port}`);
    });

    it("serves HEAD through GET handlers without writing the body", async () => {
        const server = new WebServer();
        server.router.GET("/", () => new Response("secret-body", {
            headers: {
                "content-length": "11"
            }
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {method: "HEAD"});

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("");
    });

    it("rejects oversized requests before routing", async () => {
        const server = new WebServer({
            type: "http",
            options: {},
            security: {
                maxRequestBodySize: 4
            }
        });
        server.router.POST("/", async (event) => new Response(await event.request.text()));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            method: "POST",
            body: "12345"
        });

        expect(response.status).toBe(413);
    });

    it("rejects oversized chunked requests", async () => {
        const server = new WebServer({
            type: "http",
            options: {},
            security: {
                maxRequestBodySize: 4
            }
        });
        server.router.POST("/", async (event) => new Response(await event.request.text()));

        const port = await startServer(server);
        const status = await new Promise<number>((resolve, reject) => {
            const req = httpRequest({
                host: "127.0.0.1",
                port,
                path: "/",
                method: "POST",
                headers: {
                    "Transfer-Encoding": "chunked"
                }
            }, (res) => resolve(res.statusCode ?? 0));

            req.on("error", reject);
            req.write("123");
            req.end("45");
        });

        expect(status).toBe(413);
    });

    it("rejects websocket upgrades without a matching route", async () => {
        const server = new WebServer();
        const port = await startServer(server);

        await expect(new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/missing`);
            ws.on("open", () => reject(new Error("unexpected websocket connection")));
            ws.on("error", () => resolve());
        })).resolves.toBeUndefined();
    });

    it("enforces configured websocket origins", async () => {
        const server = new WebServer({
            type: "http",
            options: {},
            security: {
                allowedWebSocketOrigins: "https://allowed.example"
            }
        });
        server.router.WS("/ws", async () => undefined);

        const port = await startServer(server);

        await expect(new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
                origin: "https://denied.example"
            });
            ws.on("open", () => reject(new Error("unexpected websocket connection")));
            ws.on("error", () => resolve());
        })).resolves.toBeUndefined();
    });
});

describe("rate limiter", () => {
    it("injects headers without recursive setHeaders calls", async () => {
        const middleware = fixedWindowLimit({max: 2});
        const captured: Record<string, string>[] = [];

        const event = {
            getClientAddress: () => "127.0.0.1",
            setHeaders: (headers: Record<string, string>) => {
                captured.push(headers);
            }
        } as any;

        const response = await middleware(event, async () => {
            event.setHeaders({"Cache-Control": "no-store"});
            return new Response("ok");
        });

        expect(response?.status).toBe(200);
        expect(captured).toHaveLength(2);
        expect(captured[0]["X-RateLimit-Limit"]).toBe("2");
        expect(captured[1]["Cache-Control"]).toBe("no-store");
        expect(captured[1]["X-RateLimit-Remaining"]).toBe("1");
    });
});

describe("router lifecycle hooks", () => {
    it("executes pre hooks before the route and post hooks after the response", async () => {
        const events: string[] = [];
        const server = new WebServer();

        server.router
            .pre(async () => {
                events.push("pre");
            })
            .post(async (_event, response) => {
                events.push("post");
                return new Response(await response.text() + "-post");
            });

        server.router.GET("/", () => {
            events.push("route");
            return new Response("ok");
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(events).toEqual(["pre", "route", "post"]);
        expect(await response.text()).toBe("ok-post");
    });

    it("allows pre hooks to short-circuit the request", async () => {
        const events: string[] = [];
        const server = new WebServer();

        server.router
            .pre(async () => {
                events.push("pre");
                return new Response("blocked", {status: 403});
            })
            .post(async () => {
                events.push("post");
            });

        server.router.GET("/", () => {
            events.push("route");
            return new Response("ok");
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.status).toBe(403);
        expect(await response.text()).toBe("blocked");
        expect(events).toEqual(["pre", "post"]);
    });
});

describe("request event behavior", () => {
    it("keeps locals stable for the lifetime of the request", async () => {
        const server = new WebServer({
            type: 'http',
            locals: () => ({ count: 0 })
        });

        server.router.useMiddleware(async (event, next) => {
            event.locals.count += 1;
            return next();
        });
        server.router.GET("/", (event) => new Response(String(event.locals.count)));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(await response.text()).toBe("1");
    });

    it("rejects duplicate and forbidden response headers", async () => {
        const server = new WebServer();
        server.router.GET("/duplicate", (event) => {
            event.setHeaders({ "Cache-Control": "no-store" });
            expect(() => event.setHeaders({ "cache-control": "max-age=60" })).toThrow(/already been set/i);
            return new Response("ok");
        });
        server.router.GET("/cookie", (event) => {
            expect(() => event.setHeaders({ "set-cookie": "a=b" })).toThrow(/event.cookies/i);
            return new Response("ok");
        });

        const port = await startServer(server);
        const duplicate = await fetch(`http://127.0.0.1:${port}/duplicate`);
        const cookie = await fetch(`http://127.0.0.1:${port}/cookie`);

        expect(duplicate.status).toBe(200);
        expect(cookie.status).toBe(200);
    });
});

describe("nested routers", () => {
    it("preserves the original URL inside nested handlers", async () => {
        const server = new WebServer();
        const nested = new Router();

        nested.GET("/users/[id]", (event) => new Response(JSON.stringify({
            pathname: event.url.pathname,
            id: event.params.id
        }), {
            headers: {
                "content-type": "application/json"
            }
        }));

        server.router.use("/api", nested);

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/users/42`);

        expect(await response.json()).toEqual({
            pathname: "/api/users/42",
            id: "42"
        });
    });

    it("keeps nested action routes working while leaving the URL untouched", async () => {
        const server = new WebServer();
        const nested = new Router();

        nested.action("/users/[id]", async (event) => ({
            pathname: event.url.pathname,
            id: event.params.id
        }));

        server.router.use("/api", nested);

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/users/42`, {
            method: "POST"
        });

        expect(await response.json()).toEqual({
            data: {
                pathname: "/api/users/42",
                id: "42"
            },
            type: "success",
            status: 200
        });
    });
});

describe("cors middleware", () => {
    it("answers valid preflight requests directly", async () => {
        const server = new WebServer();
        server.router.useMiddleware(CORS.policy({
            origin: "https://app.example.com",
            credentials: true,
            methods: ["GET", "POST"]
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/missing`, {
            method: "OPTIONS",
            headers: {
                Origin: "https://app.example.com",
                "Access-Control-Request-Method": "POST"
            }
        });

        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    });
});
