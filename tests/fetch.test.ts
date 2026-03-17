import {afterEach, describe, expect, it} from "vitest";

import {json, WebServer} from "../src";

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

describe("event.fetch", () => {
    it("supports relative internal requests", async () => {
        const server = new WebServer();

        server.GET("/inner", () => new Response("inner"));
        server.GET("/outer", async (event) => {
            const response = await event.fetch("/inner");
            return new Response(await response.text());
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/outer`);

        expect(await response.text()).toBe("inner");
    });

    it("forwards cookie and authorization headers by default", async () => {
        const server = new WebServer();

        server.GET("/inner", (event) => json({
            cookie: event.request.headers.get("cookie"),
            authorization: event.request.headers.get("authorization")
        }));

        server.GET("/outer", async (event) => {
            const response = await event.fetch("/inner");
            return new Response(await response.text(), {
                headers: {
                    "content-type": "application/json"
                }
            });
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/outer`, {
            headers: {
                cookie: "session=abc",
                authorization: "Bearer token"
            }
        });

        expect(await response.json()).toEqual({
            cookie: "session=abc",
            authorization: "Bearer token"
        });
    });

    it("allows overriding inherited headers", async () => {
        const server = new WebServer();

        server.GET("/inner", (event) => json({
            cookie: event.request.headers.get("cookie"),
            authorization: event.request.headers.get("authorization")
        }));

        server.GET("/outer", async (event) => {
            const response = await event.fetch("/inner", {
                headers: {
                    authorization: "Bearer override"
                }
            });

            return new Response(await response.text(), {
                headers: {
                    "content-type": "application/json"
                }
            });
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/outer`, {
            headers: {
                cookie: "session=abc",
                authorization: "Bearer token"
            }
        });

        expect(await response.json()).toEqual({
            cookie: "session=abc",
            authorization: "Bearer override"
        });
    });

    it("starts with route.id as null before an internal route is matched", async () => {
        const server = new WebServer();

        server.GET("/inner", (event) => json({
            routeId: event.route.id
        }));

        server.GET("/outer", async (event) => {
            const before = event.route.id;
            const response = await event.fetch("/inner");
            const body = await response.json() as { routeId: string | null };

            return json({
                before,
                inner: body.routeId,
                outer: event.route.id
            });
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/outer`);

        expect(await response.json()).toEqual({
            before: "/outer",
            inner: "/inner",
            outer: "/outer"
        });
    });
});
