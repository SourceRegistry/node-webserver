import {describe, expect, it} from "vitest";

import {WebServer} from "../src";
import {RequestId} from "../src/middlewares";
import {useServerLifecycle} from "./test-helpers";

const {startServer} = useServerLifecycle();

describe("request id middleware", () => {
    it("generates a request id, exposes it in locals, and adds it to the response", async () => {
        const server = new WebServer();
        server.useMiddleware(RequestId.assign({
            generate: () => "generated-id"
        }));
        server.GET("/", (event) => new Response(event.locals.requestId));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.headers.get("x-request-id")).toBe("generated-id");
        expect(await response.text()).toBe("generated-id");
    });

    it("reuses the incoming request id and does not overwrite an explicit response header", async () => {
        const server = new WebServer();
        server.useMiddleware(RequestId.assign());
        server.GET("/", (event) => new Response(event.locals.requestId, {
            headers: {
                "x-request-id": "route-id"
            }
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                "x-request-id": "incoming-id"
            }
        });

        expect(await response.text()).toBe("incoming-id");
        expect(response.headers.get("x-request-id")).toBe("route-id");
    });

    it("supports a custom header name", async () => {
        const server = new WebServer();
        server.useMiddleware(RequestId.assign({
            headerName: "x-correlation-id",
            generate: () => "correlation-id"
        }));
        server.GET("/", (event) => new Response(event.locals.requestId));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.headers.get("x-correlation-id")).toBe("correlation-id");
        expect(response.headers.get("x-request-id")).toBeNull();
        expect(await response.text()).toBe("correlation-id");
    });

    it("returns 400 for invalid X-Client-Request-Id (non-ASCII)", async () => {
        const server = new WebServer();
        server.useMiddleware(RequestId.assign({clientRequestId: true}));
        server.GET("/", (event) => new Response(event.locals.requestId));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                "x-client-request-id": "test\x80invalid"
            }
        });

        expect(response.status).toBe(400);
    });

    it("returns 400 for X-Client-Request-Id exceeding 512 characters", async () => {
        const server = new WebServer();
        server.useMiddleware(RequestId.assign({clientRequestId: true}));
        server.GET("/", (event) => new Response(event.locals.requestId));

        const port = await startServer(server);
        const longId = "a".repeat(513);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                "x-client-request-id": longId
            }
        });

        expect(response.status).toBe(400);
    });

    it("accepts valid X-Client-Request-Id and uses it", async () => {
        const server = new WebServer();
        server.useMiddleware(RequestId.assign({clientRequestId: true}));
        server.GET("/", (event) => new Response(event.locals.requestId));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                "x-client-request-id": "123e4567-e89b-12d3-a456-426614174000"
            }
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("123e4567-e89b-12d3-a456-426614174000");
        expect(response.headers.get("x-request-id")).toBe("123e4567-e89b-12d3-a456-426614174000");
    });

    it("ignores X-Client-Request-Id when clientRequestId is disabled", async () => {
        const server = new WebServer();
        server.useMiddleware(RequestId.assign({clientRequestId: false}));
        server.GET("/", (event) => new Response(event.locals.requestId));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                "x-client-request-id": "invalid\x80id"
            }
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("x-request-id")).not.toBe("invalid\x80id");
    });
});
