import {describe, expect, it} from "vitest";

import {WebServer} from "../src";
import {Security} from "../src/middlewares";
import {useServerLifecycle} from "./test-helpers";

const {startServer} = useServerLifecycle();

describe("security headers middleware", () => {
    it("adds secure defaults without replacing explicit headers", async () => {
        const server = new WebServer();
        server.useMiddleware(Security.headers());
        server.GET("/", () => new Response("ok", {
            headers: {
                "content-security-policy": "default-src 'none'",
                "x-frame-options": "SAMEORIGIN"
            }
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
        expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("permissions-policy")).toBe("geolocation=(), microphone=(), camera=()");
        expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
        expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        expect(response.headers.get("strict-transport-security")).toBeNull();
    });

    it("allows disabling and overriding individual headers", async () => {
        const server = new WebServer();
        server.useMiddleware(Security.headers({
            contentSecurityPolicy: false,
            frameOptions: "SAMEORIGIN",
            strictTransportSecurity: "max-age=31536000; includeSubDomains"
        }));
        server.GET("/", () => new Response("ok"));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.headers.get("content-security-policy")).toBeNull();
        expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
        expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    });
});
