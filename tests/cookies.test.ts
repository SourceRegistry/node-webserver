import {describe, expect, it} from "vitest";

import {json, WebServer} from "../src";
import {useServerLifecycle} from "./test-helpers";

const {startServer} = useServerLifecycle();

describe("cookies", () => {
    it("reads individual cookies and getAll values", async () => {
        const server = new WebServer();
        server.GET("/", (event) => json({
            session: event.cookies.get("session"),
            all: event.cookies.getAll()
        }));

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: {
                cookie: "session=abc; theme=dark"
            }
        });

        expect(await response.json()).toEqual({
            session: "abc",
            all: [
                {name: "session", value: "abc"},
                {name: "theme", value: "dark"}
            ]
        });
    });

    it("serializes set and delete cookie operations", async () => {
        const server = new WebServer();
        server.GET("/", (event) => {
            event.cookies.set("session", "abc", {path: "/", httpOnly: true});
            event.cookies.delete("theme", {path: "/"});
            return new Response("ok");
        });

        const port = await startServer(server);
        const response = await fetch(`http://127.0.0.1:${port}/`);
        const setCookie = response.headers.getSetCookie();

        expect(setCookie).toHaveLength(2);
        expect(setCookie[0]).toContain("session=abc");
        expect(setCookie[0]).toContain("Path=/");
        expect(setCookie[0]).toContain("HttpOnly");
        expect(setCookie[1]).toContain("theme=");
        expect(setCookie[1]).toContain("Max-Age=0");
    });
});
