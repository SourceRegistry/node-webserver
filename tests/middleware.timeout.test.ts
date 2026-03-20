import {describe, expect, it} from "vitest";

import {WebServer} from "../src";
import {Timeout} from "../src/middlewares";
import {useServerLifecycle} from "./test-helpers";

const {startServer} = useServerLifecycle();

describe("timeout middleware", () => {
    it("returns the route response when it completes before the deadline", async () => {
        const server = new WebServer();
        server.useMiddleware(Timeout.deadline({ms: 50}));
        server.GET("/", async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return new Response("ok");
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
    });

    it("returns a timeout response when the deadline is exceeded", async () => {
        const server = new WebServer();
        let timedOut = false;
        server.useMiddleware(Timeout.deadline({
            ms: 10,
            status: 503,
            body: "timeout",
            onTimeout: () => {
                timedOut = true;
            }
        }));
        server.GET("/", async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return new Response("late");
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.status).toBe(503);
        expect(await response.text()).toBe("timeout");
        expect(timedOut).toBe(true);
    });

    it("aborts the request signal when the deadline is exceeded", async () => {
        const server = new WebServer();
        let aborted = false;

        server.useMiddleware(Timeout.deadline({ms: 10}));
        server.GET("/", async (event) => new Promise<Response>((resolve) => {
            const timer = setTimeout(() => {
                resolve(new Response("late"));
            }, 50);

            event.request.signal.addEventListener("abort", () => {
                aborted = true;
                clearTimeout(timer);
                resolve(new Response("aborted"));
            }, {once: true});
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);

        expect(response.status).toBe(504);
        expect(await response.text()).toBe("Gateway Timeout");
        expect(aborted).toBe(true);
    });

    it("rejects non-positive timeout values", () => {
        expect(() => Timeout.deadline({ms: 0})).toThrow(/positive ms value/i);
    });
});
