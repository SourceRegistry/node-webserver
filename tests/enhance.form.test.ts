import {describe, expect, it} from "vitest";

import {enhance, Form} from "../src";
import type {Validator} from "../src";

function makeEvent(body: FormData): any {
    const request = new Request("http://localhost/users", {
        method: "POST",
        body
    });
    return {
        cookies: {} as any,
        getClientAddress: () => "127.0.0.1",
        locals: {},
        params: {},
        platform: undefined,
        request,
        route: {id: "/users"},
        setHeaders: () => {},
        url: new URL("http://localhost/users")
    };
}

describe("Form", () => {
    it("string$ throws a 400 Response with targets when the field is missing", async () => {
        const fd = new FormData();
        let caught: unknown;
        try {
            Form.string$(fd, "name");
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(400);
        expect(await (caught as Response).json()).toEqual({message: "name is required", targets: ["name"]});
    });

    it("honors a per-call onError handler", async () => {
        const fd = new FormData();
        let caught: unknown;
        try {
            Form.string$(fd, "name", ({status, message}) =>
                new Response(JSON.stringify({message: `custom: ${message}`}), {
                    status,
                    headers: {"content-type": "application/json"}
                })
            );
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(400);
        expect(await (caught as Response).json()).toEqual({message: "custom: name is required"});
    });

    it("validate() throws a Response instead of the raw ValidationFailure on failure", () => {
        const fd = new FormData();
        fd.set("foo", "bar");
        const alwaysFail: Validator<any> = () => ({success: false, errors: [{path: "foo", message: "bad"}]});

        let caught: unknown;
        try {
            Form.validate(fd, alwaysFail);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(400);
    });

    it("composes as an EventEnhancer via enhance(), same as Auth.Bearer", async () => {
        const handler = enhance(
            (event) => new Response(event.context.form.string$("name")),
            Form.enhance()
        );

        const fd = new FormData();
        fd.set("name", "ada");
        const response = await handler(makeEvent(fd));
        expect(await response.text()).toBe("ada");
    });

    it("honors a per-call onError handler passed to Form.enhance", async () => {
        const handler = enhance(
            (event) => new Response(event.context.form.string$("name")),
            Form.enhance({
                onError: ({status, message}) =>
                    new Response(JSON.stringify({message: `custom: ${message}`}), {
                        status,
                        headers: {"content-type": "application/json"}
                    })
            })
        );

        const fd = new FormData();
        let caught: unknown;
        try {
            await handler(makeEvent(fd));
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Response);
        expect((caught as Response).status).toBe(400);
        expect(await (caught as Response).json()).toEqual({message: "custom: name is required"});
    });
});
