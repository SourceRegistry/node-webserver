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

function basicHeader(username: string, password: string): string {
    return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

describe("Auth.Bearer", () => {
    it("returns the token from a valid Authorization header", () => {
        const result = Auth.Bearer()(makeEvent({Authorization: "Bearer abc123"}));
        expect(result).toEqual({token: "abc123"});
    });

    it("throws a 401 Response when the header is missing", async () => {
        let caught: unknown;
        try {
            Auth.Bearer()(makeEvent());
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
            Auth.Bearer()(makeEvent({Authorization: "Basic abc123"}));
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(401);
    });

    it("honors a per-call onError handler", async () => {
        let caught: unknown;
        try {
            Auth.Bearer({
                onError: ({status, message}) =>
                    new Response(JSON.stringify({message, custom: true}), {
                        status,
                        headers: {"content-type": "application/json"}
                    })
            })(makeEvent());
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
            Auth.Bearer({
                onError: (ctx) => {
                    seenRequest = ctx.request;
                    return new Response(null, {status: ctx.status});
                }
            })(makeEvent());
        } catch {
            // expected: the handler's return value is still thrown by Auth.Bearer
        }
        expect(seenRequest).toBeDefined();
    });
});

describe("Auth.Basic", () => {
    it("resolves the lookup result onto context.user for valid credentials", async () => {
        const lookup = (creds: {username: string; password: string}) =>
            creds.username === "alice" && creds.password === "secret" ? {id: "u_1"} : undefined;

        const result = await Auth.Basic(lookup)(makeEvent({Authorization: basicHeader("alice", "secret")}));
        expect(result).toEqual({user: {id: "u_1"}});
    });

    it("passes username/password/request to lookup", async () => {
        let seen: any;
        const lookup = (creds: any) => {
            seen = creds;
            return {ok: true};
        };

        await Auth.Basic(lookup)(makeEvent({Authorization: basicHeader("bob", "p:w")}));
        expect(seen.username).toBe("bob");
        expect(seen.password).toBe("p:w"); // password may contain colons per RFC 7617
        expect(seen.request).toBeInstanceOf(Request);
    });

    it("throws a 401 with WWW-Authenticate when the header is missing", async () => {
        let caught: unknown;
        try {
            await Auth.Basic(() => ({ok: true}))(makeEvent());
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(401);
        expect((caught as Response).headers.get("www-authenticate")).toBe('Basic realm="Restricted"');
    });

    it("uses the configured realm in WWW-Authenticate", async () => {
        let caught: unknown;
        try {
            await Auth.Basic(() => undefined, {realm: "Admin Area"})(
                makeEvent({Authorization: basicHeader("x", "y")})
            );
        } catch (e) {
            caught = e;
        }
        expect((caught as Response).headers.get("www-authenticate")).toBe('Basic realm="Admin Area"');
    });

    it("throws a 401 when lookup returns a falsy value", async () => {
        let caught: unknown;
        try {
            await Auth.Basic(() => undefined)(makeEvent({Authorization: basicHeader("alice", "wrong")}));
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(401);
    });

    it("honors a per-call onError handler", async () => {
        let caught: unknown;
        try {
            await Auth.Basic(() => undefined, {
                onError: ({status, message}) => new Response(JSON.stringify({message, custom: true}), {status})
            })(makeEvent());
        } catch (e) {
            caught = e;
        }
        expect(await (caught as Response).json()).toEqual({message: "Invalid or missing Basic credentials", custom: true});
    });
});
