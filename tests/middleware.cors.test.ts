import {describe, expect, it} from "vitest";

import {WebServer} from "../src";
import {CORS} from "../src/middlewares";
import {useServerLifecycle} from "./test-helpers";

const {startServer} = useServerLifecycle();

describe("cors middleware", () => {
    it("answers valid preflight requests directly", async () => {
        const server = new WebServer();
        server.useMiddleware(CORS.policy({
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

    it("rejects denied preflight requests", async () => {
        const server = new WebServer();
        server.useMiddleware(CORS.policy({
            origin: "https://app.example.com"
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/missing`, {
            method: "OPTIONS",
            headers: {
                Origin: "https://evil.example",
                "Access-Control-Request-Method": "POST"
            }
        });

        expect(response.status).toBe(403);
    });

    it("adds headers to actual requests and supports onResponse overrides", async () => {
        const server = new WebServer();
        server.useMiddleware(CORS.policy({
            origin: [/^https:\/\/app\./],
            credentials: true,
            exposedHeaders: ["x-extra"],
            onResponse: (response) => {
                response.headers.set("x-cors-hook", "ran");
            }
        }));
        server.GET("/", () => new Response("ok", {
            headers: {
                "x-extra": "present"
            }
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                Origin: "https://app.example.com"
            }
        });

        expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
        expect(response.headers.get("access-control-allow-credentials")).toBe("true");
        expect(response.headers.get("access-control-expose-headers")).toBe("x-extra");
        expect(response.headers.get("x-cors-hook")).toBe("ran");
    });

    it("supports function origins and wildcard behavior", async () => {
        const server = new WebServer();
        server.useMiddleware(CORS.policy({
            origin: (origin) => origin.endsWith(".example.com")
        }));
        server.GET("/fn", () => new Response("ok"));

        const wildcard = new WebServer();
        wildcard.useMiddleware(CORS.policy({
            origin: "*",
            credentials: true
        }));
        wildcard.GET("/", () => new Response("ok"));

        const functionPort = await startServer(server);
        const wildcardPort = await startServer(wildcard);

        const allowed = await fetch(`http://127.0.0.1:${functionPort}/fn`, {
            headers: {
                Origin: "https://admin.example.com"
            }
        });
        const reflected = await fetch(`http://127.0.0.1:${wildcardPort}/`, {
            headers: {
                Origin: "https://client.example.com"
            }
        });

        expect(allowed.headers.get("access-control-allow-origin")).toBe("https://admin.example.com");
        expect(reflected.headers.get("access-control-allow-origin")).toBe("https://client.example.com");
    });
});
