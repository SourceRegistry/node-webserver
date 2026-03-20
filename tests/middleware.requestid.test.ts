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
});
