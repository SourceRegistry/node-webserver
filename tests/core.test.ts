import {request as httpRequest} from "node:http";

import {describe, expect, it} from "vitest";
import {WebSocket} from "ws";

import {error, json, redirect, Router, sse, WebServer, text} from "../src";
import {useServerLifecycle} from "./test-helpers";

const {startServer} = useServerLifecycle();

describe("server hardening", () => {
    it("uses byte length for helper responses", async () => {
        const response = await text("€");

        expect(response.headers.get("content-length")).toBe("3");
    });

    it("does not trust Host by default when building event URLs", async () => {
        const server = new WebServer();
        server.GET("/", (event) => new Response(event.url.host));

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

    it("does not trust forwarded headers by default", async () => {
        const server = new WebServer();
        server.GET("/", (event) => json({
            host: event.url.host,
            protocol: event.url.protocol,
            client: event.getClientAddress()
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                Host: "evil.example",
                "X-Forwarded-For": "203.0.113.10",
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": "app.example.com"
            }
        });

        expect(await response.json()).toEqual({
            host: `127.0.0.1:${port}`,
            protocol: "http:",
            client: "127.0.0.1"
        });
    });

    it("trusts forwarded client, protocol, and host from trusted proxies", async () => {
        const server = new WebServer({
            type: "http",
            options: {},
            security: {
                trustedProxies: [/127\.0\.0\.1/, /::1/, /::ffff:127\.0\.0\.1/, "198.51.100.2"],
                trustHostHeader: true,
                allowedHosts: "app.example.com"
            }
        });
        server.GET("/", (event) => json({
            host: event.url.host,
            protocol: event.url.protocol,
            client: event.getClientAddress()
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                Host: "ignored.example",
                "X-Forwarded-For": "203.0.113.10, 198.51.100.2",
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": "app.example.com"
            }
        });

        expect(await response.json()).toEqual({
            host: "app.example.com",
            protocol: "https:",
            client: "203.0.113.10"
        });
    });

    it("falls back when the forwarded host is not allowed", async () => {
        const server = new WebServer({
            type: "http",
            options: {},
            security: {
                trustedProxies: [/127\.0\.0\.1/, /::1/, /::ffff:127\.0\.0\.1/],
                trustHostHeader: true,
                allowedHosts: "app.example.com"
            }
        });
        server.GET("/", (event) => new Response(event.url.host));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                "X-Forwarded-Host": "evil.example"
            }
        });

        expect(await response.text()).toBe(`127.0.0.1:${port}`);
    });

    it("serves HEAD through GET handlers without writing the body", async () => {
        const server = new WebServer();
        server.GET("/", () => new Response("secret-body", {
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
        server.POST("/", async (event) => new Response(await event.request.text()));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            method: "POST",
            body: "12345"
        });

        expect(response.status).toBe(413);
    });

    it("applies conservative timeout defaults and allows overrides", async () => {
        const previousNodeEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "development";

            const defaults = new WebServer();
            await startServer(defaults);

            const defaultNodeServer = (defaults as any).server;
            expect(defaultNodeServer.headersTimeout).toBe(30_000);
            expect(defaultNodeServer.requestTimeout).toBe(0);
            expect(defaultNodeServer.keepAliveTimeout).toBe(5_000);

            const custom = new WebServer({
                type: "http",
                options: {},
                security: {
                    headersTimeoutMs: 15_000,
                    requestTimeoutMs: 45_000,
                    keepAliveTimeoutMs: 2_000
                }
            });
            await startServer(custom);

            const customNodeServer = (custom as any).server;
            expect(customNodeServer.headersTimeout).toBe(15_000);
            expect(customNodeServer.requestTimeout).toBe(45_000);
            expect(customNodeServer.keepAliveTimeout).toBe(2_000);

            process.env.NODE_ENV = "production";
            const production = new WebServer();
            await startServer(production);

            const productionNodeServer = (production as any).server;
            expect(productionNodeServer.requestTimeout).toBe(60_000);
        } finally {
            process.env.NODE_ENV = previousNodeEnv;
        }
    });

    it("rejects oversized chunked requests", async () => {
        const server = new WebServer({
            type: "http",
            options: {},
            security: {
                maxRequestBodySize: 4
            }
        });
        server.POST("/", async (event) => new Response(await event.request.text()));

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
        server.WS("/ws", async () => undefined);

        const port = await startServer(server);

        await expect(new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
                origin: "https://denied.example"
            });
            ws.on("open", () => reject(new Error("unexpected websocket connection")));
            ws.on("error", () => resolve());
        })).resolves.toBeUndefined();
    });

    it("routes websocket params through middleware and decodes them", async () => {
        const server = new WebServer();
        let seen: {slug?: string; gated?: boolean} | undefined;

        server.WS("/ws/[slug]", (event) => {
            seen = {
                slug: event.params.slug,
                gated: (event.locals as {gated?: boolean}).gated
            };
            event.websocket.close(1000, "done");
        }, async (event, next) => {
            Object.assign(event.locals, {gated: true});
            return next();
        });

        const port = await startServer(server);
        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/hello%20world`);
            ws.on("close", () => resolve());
            ws.on("error", reject);
        });

        expect(seen).toEqual({
            slug: "hello world",
            gated: true
        });
    });

    it("routes nested websockets and decodes prefix params", async () => {
        const server = new WebServer();
        const nested = new Router();
        let seen: {tenant?: string; room?: string; gated?: boolean} | undefined;

        nested.WS("/room/[id]", (event) => {
            seen = {
                tenant: event.params.tenant,
                room: event.params.id,
                gated: (event.locals as {gated?: boolean}).gated
            };
            event.websocket.close(1000, "done");
        });

        server.use([
            "/ws/[tenant]",
            nested,
            async (event, next) => {
                Object.assign(event.locals, {gated: true});
                return next();
            }
        ]);

        const port = await startServer(server);
        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/acme%20inc/room/general%20chat`);
            ws.on("close", () => resolve());
            ws.on("error", reject);
        });

        expect(seen).toEqual({
            tenant: "acme inc",
            room: "general chat",
            gated: true
        });
    });

    it("treats websocket middleware short-circuits as handled", async () => {
        const server = new WebServer();

        server.WS("/ws", async () => {
            throw new Error("handler should not run");
        }, async () => new Response("blocked", {status: 403}));

        const handled = await server.handleWebSocket({
            request: new Request("http://127.0.0.1/ws"),
            url: new URL("http://127.0.0.1/ws"),
            cookies: {} as any,
            getClientAddress: () => "127.0.0.1",
            locals: {},
            params: {},
            platform: undefined,
            fetch,
            route: {id: null},
            setHeaders: () => {}
        }, {
            readyState: WebSocket.OPEN,
            close: () => {}
        } as any);

        expect(handled).toBe(true);
    });
});

describe("router lifecycle hooks", () => {
    it("executes pre hooks before the route and post hooks after the response", async () => {
        const events: string[] = [];
        const server = new WebServer();

        server
            .pre(async () => {
                events.push("pre");
            })
            .post(async (_event, response) => {
                events.push("post");
                return new Response(await response.text() + "-post");
            });

        server.GET("/", () => {
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

        server
            .pre(async () => {
                events.push("pre");
                return new Response("blocked", {status: 403});
            })
            .post(async () => {
                events.push("post");
            });

        server.GET("/", () => {
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
            type: "http",
            locals: () => ({count: 0})
        });

        server.useMiddleware(async (event, next) => {
            event.locals.count += 1;
            return next();
        });
        server.GET("/", (event) => new Response(String(event.locals.count)));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(await response.text()).toBe("1");
    });

    it("rejects duplicate and forbidden response headers", async () => {
        const server = new WebServer();
        server.GET("/duplicate", (event) => {
            event.setHeaders({"Cache-Control": "no-store"});
            expect(() => event.setHeaders({"cache-control": "max-age=60"})).toThrow(/already been set/i);
            return new Response("ok");
        });
        server.GET("/cookie", (event) => {
            expect(() => event.setHeaders({"set-cookie": "a=b"})).toThrow(/event.cookies/i);
            return new Response("ok");
        });

        const port = await startServer(server);
        const duplicate = await fetch(`http://127.0.0.1:${port}/duplicate`);
        const cookie = await fetch(`http://127.0.0.1:${port}/cookie`);

        expect(duplicate.status).toBe(200);
        expect(cookie.status).toBe(200);
    });

    it("merges custom platform data onto the default platform", async () => {
        const previousNodeEnv = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "development";

            const server = new WebServer({
                type: "http",
                platform: () => ({
                    region: "eu-west-1"
                })
            });
            server.GET("/", (event) => json({
                name: event.platform?.name,
                dev: (event.platform as {dev?: boolean} | undefined)?.dev,
                region: (event.platform as {region?: string} | undefined)?.region
            }));

            const port = await startServer(server);
            const response = await fetch(`http://127.0.0.1:${port}/`);

            expect(await response.json()).toEqual({
                name: "node-webserver",
                dev: true,
                region: "eu-west-1"
            });
        } finally {
            process.env.NODE_ENV = previousNodeEnv;
        }
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

        server.use("/api", nested);

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

        server.use("/api", nested);

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

    it("returns thrown redirects from nested routers immediately", async () => {
        const server = new WebServer();
        const nested = new Router();

        nested.GET("/old", () => redirect(302, "/target"));

        server.use("/api", nested);

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/api/old`, {
            redirect: "manual"
        });

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/target");
    });

    it("decodes nested params and leaves missing optional params undefined", async () => {
        const server = new WebServer();
        const nested = new Router();

        nested.GET("/files/[[name]]", (event) => json({
            hasName: "name" in event.params,
            name: event.params.name
        }));

        server.use("/api/[tenant]", nested);

        const port = await startServer(server);
        const withName = await fetch(`http://127.0.0.1:${port}/api/acme%20inc/files/report%202024`);
        const withoutName = await fetch(`http://127.0.0.1:${port}/api/acme%20inc/files`);

        expect(await withName.json()).toEqual({
            hasName: true,
            name: "report 2024"
        });
        expect(await withoutName.json()).toEqual({
            hasName: false
        });
    });
});

describe("router matching", () => {
    it("decodes route params and keeps missing optional params undefined", async () => {
        const server = new WebServer();

        server.GET("/users/[[id]]", (event) => json({
            hasId: "id" in event.params,
            id: event.params.id
        }));

        const port = await startServer(server);
        const withId = await fetch(`http://127.0.0.1:${port}/users/alexa%20dev`);
        const withoutId = await fetch(`http://127.0.0.1:${port}/users`);

        expect(await withId.json()).toEqual({
            hasId: true,
            id: "alexa dev"
        });
        expect(await withoutId.json()).toEqual({
            hasId: false
        });
    });

    it("prefers static routes over dynamic and catch-all matches", async () => {
        const server = new WebServer();

        server.GET("/users/[id]", () => new Response("dynamic"));
        server.GET("/users/settings", () => new Response("static"));
        server.GET("/users/[...rest]", () => new Response("catch-all"));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/users/settings`);

        expect(await response.text()).toBe("static");
    });

    it("returns allow headers for OPTIONS and 405 responses", async () => {
        const server = new WebServer();

        server.GET("/resource", () => new Response("ok"));
        server.POST("/resource", () => new Response("created"));

        const port = await startServer(server);
        const options = await fetch(`http://127.0.0.1:${port}/resource`, {method: "OPTIONS"});
        const put = await fetch(`http://127.0.0.1:${port}/resource`, {method: "PUT"});

        expect(options.status).toBe(200);
        expect(options.headers.get("allow")).toBe("GET, HEAD, POST");
        expect(put.status).toBe(405);
        expect(put.headers.get("allow")).toBe("GET, HEAD, POST");
    });

    it("can discard a previously registered route", async () => {
        const server = new WebServer();

        server.GET("/gone", () => new Response("still here"));
        server.discard("/gone", "GET");

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/gone`);

        expect(response.status).toBe(404);
    });
});

describe("thrown response helpers", () => {
    it("returns thrown route errors without falling through", async () => {
        const server = new WebServer();

        server.GET("/", () => error(418, "short and stout"));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.status).toBe(418);
        expect(await response.json()).toEqual({
            message: "short and stout"
        });
    });
});

describe("actions", () => {
    it("formats failure results, redirects, and unexpected errors", async () => {
        const server = new WebServer();

        server.action("/failure", async () => ({
            type: "failure",
            status: 422,
            data: {field: "email"}
        } as const));
        server.action("/redirect", async () => redirect(303, "/target"));
        server.action("/crash", async () => {
            throw new Error("boom");
        });

        const port = await startServer(server);
        const failure = await fetch(`http://127.0.0.1:${port}/failure`, {method: "POST"});
        const redirectResponse = await fetch(`http://127.0.0.1:${port}/redirect`, {
            method: "POST",
            redirect: "manual"
        });
        const crash = await fetch(`http://127.0.0.1:${port}/crash`, {method: "POST"});

        expect(failure.status).toBe(422);
        expect(await failure.json()).toEqual({
            data: {field: "email"},
            type: "failure",
            status: 422
        });
        expect(redirectResponse.status).toBe(303);
        expect(await redirectResponse.json()).toEqual({
            location: "/target",
            type: "redirect",
            status: 303
        });
        expect(crash.status).toBe(500);
        expect(await crash.json()).toEqual({
            error: {message: "Internal Server Error"},
            type: "error",
            status: 500
        });
    });
});

describe("sse helper", () => {
    it("streams events and respects response init options", async () => {
        const server = new WebServer();

        server.GET("/events", sse((_event, emit) => {
            emit({ok: true}, {event: "message", id: "1"});
            emit("ready", {comment: "connected"});
        }, {
            status: 202,
            headers: {
                "x-stream": "enabled"
            }
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/events`);
        const reader = response.body?.getReader();

        expect(response.status).toBe(202);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        expect(response.headers.get("x-stream")).toBe("enabled");

        const chunk = await reader?.read();
        const body = chunk?.value ? Buffer.from(chunk.value).toString("utf8") : "";

        expect(body).toContain("event: message");
        expect(body).toContain("id: 1");
        expect(body).toContain('data: {"ok":true}');
        expect(body).toContain(": connected");
        expect(body).toContain("data: ready");

        await reader?.cancel();
    });

    it("runs cleanup when the client disconnects mid-stream", async () => {
        const server = new WebServer();
        let cleaned = false;

        server.GET("/events", sse((_event, emit) => {
            const timer = setInterval(() => {
                emit({ok: true});
            }, 10);

            return () => {
                cleaned = true;
                clearInterval(timer);
            };
        }));

        const port = await startServer(server);
        await new Promise<void>((resolve, reject) => {
            const req = httpRequest({
                host: "127.0.0.1",
                port,
                path: "/events",
                method: "GET"
            }, (res) => {
                res.once("data", () => {
                    req.destroy();
                    setTimeout(resolve, 50);
                });
            });

            req.on("error", reject);
            req.end();
        });

        expect(cleaned).toBe(true);
    });
});

describe("stream lifecycle", () => {
    it("aborts generic streaming responses when the client disconnects", async () => {
        const server = new WebServer();
        let aborted = false;

        server.GET("/stream", (event) => {
            const encoder = new TextEncoder();
            let timer: ReturnType<typeof setInterval> | undefined;
            let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

            event.request.signal.addEventListener("abort", () => {
                aborted = true;
                if (timer) {
                    clearInterval(timer);
                }
                try {
                    controllerRef?.close();
                } catch {
                }
            }, {once: true});

            return new Response(new ReadableStream<Uint8Array>({
                start(controller) {
                    controllerRef = controller;
                    timer = setInterval(() => {
                        controller.enqueue(encoder.encode("chunk\n"));
                    }, 10);
                },
                cancel() {
                    if (timer) {
                        clearInterval(timer);
                    }
                }
            }));
        });

        const port = await startServer(server);
        await new Promise<void>((resolve, reject) => {
            const req = httpRequest({
                host: "127.0.0.1",
                port,
                path: "/stream",
                method: "GET"
            }, (res) => {
                res.once("data", () => {
                    req.destroy();
                    setTimeout(resolve, 50);
                });
            });

            req.on("error", reject);
            req.end();
        });

        expect(aborted).toBe(true);
    });
});
