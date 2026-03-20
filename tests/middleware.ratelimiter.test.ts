import {describe, expect, it} from "vitest";

import {fixedWindowLimit} from "../src/middlewares/ratelimiter";
import {MemoryStore} from "../src/middlewares/ratelimiter/InMemory";

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

    it("returns a limit response with JSON body and callback info", async () => {
        const store = {
            async incr() {
                return {current: 3, reset: Date.now() + 1000};
            }
        };
        const hits: Array<{ current: number; max: number; key: string }> = [];
        const middleware = fixedWindowLimit({
            max: 2,
            message: {message: "slow down"},
            onRateLimit: (_event, info) => {
                hits.push(info);
            },
            store
        });

        const response = await middleware({
            getClientAddress: () => "127.0.0.1"
        } as any, async () => new Response("ok"));

        expect(response?.status).toBe(429);
        expect(response?.headers.get("content-type")).toBe("application/json");
        expect(response?.headers.get("retry-after")).toBeTruthy();
        expect(await response?.json()).toEqual({message: "slow down"});
        expect(hits).toEqual([{
            current: 3,
            max: 2,
            key: "rl:127.0.0.1"
        }]);
    });

    it("supports removing rate limit headers", async () => {
        const middleware = fixedWindowLimit({
            max: 1,
            headers: "remove",
            store: {
                async incr() {
                    return {current: 2, reset: Date.now() + 1000};
                }
            }
        });

        const response = await middleware({
            getClientAddress: () => "127.0.0.1",
            setHeaders: () => {
                throw new Error("should not set headers");
            }
        } as any, async () => new Response("ok"));

        expect(response?.status).toBe(429);
        expect(response?.headers.get("x-ratelimit-limit")).toBeNull();
        expect(response?.headers.get("retry-after")).toBeNull();
    });
});

describe("rate limiter memory store", () => {
    it("increments, resets, and clears keys", async () => {
        const store = new MemoryStore({windowMs: 5});

        const first = await store.incr("a");
        const second = await store.incr("a");
        await new Promise((resolve) => setTimeout(resolve, 10));
        const afterWindow = await store.incr("a");
        await store.resetAll();
        const afterReset = await store.incr("a");

        expect(first.current).toBe(1);
        expect(second.current).toBe(2);
        expect(afterWindow.current).toBe(1);
        expect(afterReset.current).toBe(1);

        store.stop();
    });
});
