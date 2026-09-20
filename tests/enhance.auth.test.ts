import {describe, expect, it} from "vitest";

import {Auth} from "../src";
import type {EnhancedEvent} from "../src";

function makeEvent(headers: Record<string, string> = {}): EnhancedEvent {
    return {
        cookies: {} as any,
        getClientAddress: () => "127.0.0.1",
        locals: {},
        params: {},
        platform: undefined,
        request: new Request("http://localhost/users", {headers}),
        route: {id: "/users"},
        setHeaders: () => {},
        url: new URL("http://localhost/users")
    };
}

describe("Auth.Bearer", () => {
    it("returns the token from a valid Authorization header", () => {
        const result = Auth.Bearer(makeEvent({Authorization: "Bearer abc123"}));
        expect(result).toEqual({token: "abc123"});
    });

    it("throws a 401 Response when the header is missing", async () => {
        let caught: unknown;
        try {
            Auth.Bearer(makeEvent());
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(401);
        expect(await (caught as Response).json()).toEqual({message: "Invalid or missing Bearer token"});
    });

    it("throws a 401 Response when the header isn't a Bearer token", () => {
        let caught: unknown;
        try {
            Auth.Bearer(makeEvent({Authorization: "Basic abc123"}));
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(401);
    });

    it("honors a per-call onError handler", async () => {
        let caught: unknown;
        try {
            Auth.Bearer(makeEvent(), {
                onError: ({status, message}) =>
                    new Response(JSON.stringify({message, custom: true}), {
                        status,
                        headers: {"content-type": "application/json"}
                    })
            });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(401);
        expect(await (caught as Response).json()).toEqual({message: "Invalid or missing Bearer token", custom: true});
    });

    it("passes the event through to onError as `request`", () => {
        let seenRequest: unknown;
        try {
            Auth.Bearer(makeEvent(), {
                onError: (ctx) => {
                    seenRequest = ctx.request;
                    return new Response(null, {status: ctx.status});
                }
            });
        } catch {
            // expected: the handler's return value is still thrown by Auth.Bearer
        }
        expect(seenRequest).toBeDefined();
    });
});
