import {describe, expect, it} from "vitest";

import {enhance, error, redirect} from "../src";

describe("enhance", () => {
    it("merges enhancer output onto event.context", async () => {
        const handler = enhance(
            (event) => new Response(`${event.context.userId}:${event.context.role}`),
            async () => ({userId: "u_1"}),
            () => ({role: "admin"})
        );

        const response = await handler({
            cookies: {} as any,
            getClientAddress: () => "127.0.0.1",
            locals: {},
            params: {},
            platform: undefined,
            request: new Request("http://localhost/users"),
            route: {id: "/users"},
            setHeaders: () => {},
            url: new URL("http://localhost/users")
        });

        expect(await response.text()).toBe("u_1:admin");
    });

    it("allows enhancers to short-circuit by returning a Response", async () => {
        const handler = enhance(
            () => new Response("ok"),
            () => new Response("blocked", {status: 401})
        );

        const response = await handler({
            cookies: {} as any,
            getClientAddress: () => "127.0.0.1",
            locals: {},
            params: {},
            platform: undefined,
            request: new Request("http://localhost/users"),
            route: {id: "/users"},
            setHeaders: () => {},
            url: new URL("http://localhost/users")
        });

        expect(response.status).toBe(401);
        expect(await response.text()).toBe("blocked");
    });

    it("preserves thrown Response control flow from enhancers", async () => {
        const handler = enhance(
            () => new Response("ok"),
            () => {
                error(403, {message: "forbidden"});
            }
        );

        await expect(handler({
            cookies: {} as any,
            getClientAddress: () => "127.0.0.1",
            locals: {},
            params: {},
            platform: undefined,
            request: new Request("http://localhost/users"),
            route: {id: "/users"},
            setHeaders: () => {},
            url: new URL("http://localhost/users")
        })).rejects.toBeInstanceOf(Response);
    });

    it("preserves redirects thrown from enhancers", async () => {
        const handler = enhance(
            () => new Response("ok"),
            () => {
                redirect(302, "/login");
            }
        );

        await expect(handler({
            cookies: {} as any,
            getClientAddress: () => "127.0.0.1",
            locals: {},
            params: {},
            platform: undefined,
            request: new Request("http://localhost/users"),
            route: {id: "/users"},
            setHeaders: () => {},
            url: new URL("http://localhost/users")
        })).rejects.toBeInstanceOf(Response);
    });
});
