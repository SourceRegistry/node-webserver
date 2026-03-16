# @sourceregistry/node-webserver

[![npm version](https://img.shields.io/npm/v/%40sourceregistry%2Fnode-webserver?logo=npm)](https://www.npmjs.com/package/@sourceregistry/node-webserver)
[![License](https://img.shields.io/npm/l/%40sourceregistry%2Fnode-webserver)](./LICENSE)
[![CI](https://github.com/SourceRegistry/node-webserver/actions/workflows/test.yml/badge.svg)](https://github.com/SourceRegistry/node-webserver/actions/workflows/test.yml)

TypeScript web server for Node.js built around the web platform `Request` and `Response` APIs.

It provides:

- A typed router with path params
- Middleware support
- Router lifecycle hooks with `pre()` and `post()`
- WebSocket routing
- Cookie helpers
- Built-in CORS and rate limiting middleware
- Safer defaults for host handling and WebSocket upgrade validation

## Installation

```bash
npm install @sourceregistry/node-webserver
```

Node.js 18+ is required.

## Quick Start

```ts
import { WebServer, json, text } from "@sourceregistry/node-webserver";

const app = new WebServer();

app.GET("/", () => text("hello world"));

app.GET("/health", () => json({
  ok: true
}));

app.listen(3000, () => {
  console.log("listening on http://127.0.0.1:3000");
});
```

## Core Concepts

### Create a server

```ts
import { WebServer } from "@sourceregistry/node-webserver";

const app = new WebServer();
```

`WebServer` extends `Router`, so you can register routes and middleware directly on `app`.

You can also pass handler callbacks for `locals` and `platform`:

```ts
const app = new WebServer({
  locals: (event) => ({
    requestId: crypto.randomUUID(),
    ip: event.getClientAddress()
  }),
  platform: () => ({
    name: "node"
  })
});
```

### Register routes

```ts
app.GET("/users", async () => {
  return new Response("all users");
});

app.GET("/users/[id]", async (event) => {
  return new Response(`user ${event.params.id}`);
});

app.POST("/users", async (event) => {
  const body = await event.request.json();
  return json({ created: true, body }, { status: 201 });
});
```

Supported HTTP methods:

- `GET`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`
- `HEAD`
- `OPTIONS`
- `USE` to register the same handler for all methods

### Nested routers

```ts
import { Router } from "@sourceregistry/node-webserver";

const api = new Router();

api.GET("/status", () => new Response("ok"));

app.use("/api", api);
```

### Response helpers

The library exports helpers for common content types:

```ts
import { html, json, text } from "@sourceregistry/node-webserver";

app.GET("/", () => html("<h1>Hello</h1>"));
app.GET("/message", () => text("plain text"));
app.GET("/data", () => json({ ok: true }));
```

It also exports `redirect()` and `error()` for control flow. These helpers throw a `Response`, and the router immediately returns that response without continuing route resolution. This works in normal routes, middleware, lifecycle hooks, and nested routers.

```ts
import { error, redirect } from "@sourceregistry/node-webserver";

app.GET("/old", () => {
  redirect(302, "/new");
});

app.GET("/admin", (event) => {
  if (!event.locals.userId) {
    error(401, { message: "Unauthorized" });
  }

  return new Response("secret");
});
```

Nested routers short-circuit the same way:

```ts
const api = new Router();

api.GET("/legacy", () => {
  redirect(301, "/api/v2");
});

app.use("/api", api);
```

## Request Handling

Route handlers receive a web-standard `Request` plus extra routing data:

```ts
app.GET("/posts/[slug]", async (event) => {
  const userAgent = event.request.headers.get("user-agent");
  const slug = event.params.slug;
  const ip = event.getClientAddress();

  event.setHeaders({
    "Cache-Control": "no-store"
  });

  return json({
    slug,
    userAgent,
    ip
  });
});
```

Available fields include:

- `event.request`
- `event.url`
- `event.params`
- `event.locals`
- `event.platform`
- `event.cookies`
- `event.getClientAddress()`
- `event.setHeaders(...)`

## App Typings

You can extend the request-local and platform typings by adding your own `app.d.ts` file in your project:

```ts
declare global {
  namespace App {
    interface Locals {
      userId?: string;
      requestId: string;
    }

    interface Platform {
      name: string;
    }
  }
}

export {};
```

The server will use those `App.Locals` and `App.Platform` definitions automatically in route handlers, middleware, and lifecycle hooks.

## Middleware

Middleware wraps request handling and can short-circuit the chain.

```ts
app.useMiddleware(async (event, next) => {
  const startedAt = Date.now();
  const response = await next();

  if (!response) {
    return new Response("No response", { status: 500 });
  }

  const nextResponse = new Response(response.body, response);
  nextResponse.headers.set("x-response-time", String(Date.now() - startedAt));
  return nextResponse;
});
```

Route-specific middleware:

```ts
const requireApiKey = async (event, next) => {
  if (event.request.headers.get("x-api-key") !== process.env.API_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  return next();
};

app.GET("/admin", () => new Response("secret"), requireApiKey);
```

## Router Lifecycle Hooks

Use `pre()` for logic that should run before route resolution, and `post()` for logic that should run after a response has been produced.

### `pre()`

`pre()` can short-circuit the request by returning a `Response`.

```ts
app.pre(async (event) => {
  if (!event.request.headers.get("authorization")) {
    return new Response("Unauthorized", { status: 401 });
  }
});
```

### `post()`

`post()` receives the final response and may replace it.

```ts
app.post(async (_event, response) => {
  const nextResponse = new Response(response.body, response);
  nextResponse.headers.set("x-powered-by", "node-webserver");
  return nextResponse;
});
```

## Cookies

```ts
app.GET("/login", async (event) => {
  event.cookies.set("session", "abc123", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true
  });

  return new Response("logged in");
});

app.GET("/me", async (event) => {
  const session = event.cookies.get("session");
  return json({ session });
});

app.POST("/logout", async (event) => {
  event.cookies.delete("session", {
    path: "/",
    httpOnly: true,
    secure: true
  });

  return new Response("logged out");
});
```

## WebSocket Routes

```ts
app.WS("/ws/chat/[room]", async (event) => {
  const room = event.params.room;
  const ws = event.websocket;

  ws.send(`joined:${room}`);

  ws.on("message", (message) => {
    ws.send(`echo:${message.toString()}`);
  });
});
```

## Static Files

Use `dir()` to expose a directory through a route, or `serveStatic()` directly if you want manual control.

```ts
import { dir } from "@sourceregistry/node-webserver";

app.GET("/assets/[...path]", dir("./public/assets"));
app.GET("/", dir("./public"));
```

Manual usage:

```ts
import { serveStatic } from "@sourceregistry/node-webserver";

app.GET("/downloads/[...path]", (event) => {
  return serveStatic("./downloads", event, {
    cacheControl: "public, max-age=3600"
  });
});
```

The helper canonicalizes and validates the requested path, rejects traversal attempts such as `../secret.txt` and encoded variants like `..%2fsecret.txt`, and verifies that symlinks cannot escape the configured root.

## Security Options

The server includes a `security` config block for safer defaults.

```ts
const app = new WebServer({
  type: "http",
  options: {},
  security: {
    maxRequestBodySize: 1024 * 1024,
    maxWebSocketPayload: 64 * 1024,
    allowedWebSocketOrigins: [
      "https://app.example.com",
      "https://admin.example.com"
    ]
  }
});
```

Available options:

- `trustHostHeader`
- `allowedHosts`
- `allowedWebSocketOrigins`
- `maxRequestBodySize`
- `maxWebSocketPayload`

`trustHostHeader` defaults to `false`. That is the safer default for public-facing services unless you are explicitly validating proxy behavior.

## Built-in Middleware

### CORS

```ts
import { CORS } from "@sourceregistry/node-webserver";

app.useMiddleware(CORS.policy({
  origin: ["https://app.example.com"],
  credentials: true,
  methods: ["GET", "POST", "DELETE"]
}));
```

### Rate Limiting

```ts
import { RateLimiter } from "@sourceregistry/node-webserver";

app.useMiddleware(RateLimiter.fixedWindowLimit({
  windowMs: 60_000,
  max: 100
}));
```

## HTTPS Server

```ts
import { readFileSync } from "node:fs";
import { WebServer } from "@sourceregistry/node-webserver";

const app = new WebServer({
  type: "https",
  options: {
    key: readFileSync("./certs/server.key"),
    cert: readFileSync("./certs/server.crt")
  }
});

app.GET("/", () => new Response("secure"));
app.listen(3443);
```

## Full Example

```ts
import {
  CORS,
  RateLimiter,
  WebServer,
  json,
  text
} from "@sourceregistry/node-webserver";

const app = new WebServer({
  type: "http",
  options: {},
  locals: () => ({
    startedAt: Date.now()
  }),
  security: {
    maxRequestBodySize: 1024 * 1024,
    allowedWebSocketOrigins: "https://app.example.com"
  }
});

app.pre(async (event) => {
  if (event.url.pathname.startsWith("/private")) {
    const auth = event.request.headers.get("authorization");
    if (!auth) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
});

app.useMiddleware(
  CORS.policy({
    origin: "https://app.example.com",
    credentials: true
  }),
  RateLimiter.fixedWindowLimit({
    max: 60,
    windowMs: 60_000
  })
);

app.GET("/", () => text("hello"));

app.GET("/users/[id]", (event) => {
  return json({
    id: event.params.id,
    requestId: event.locals.startedAt
  });
});

app.post(async (_event, response) => {
  const nextResponse = new Response(response.body, response);
  nextResponse.headers.set("x-server", "node-webserver");
  return nextResponse;
});

app.listen(3000, () => {
  console.log("server listening on port 3000");
});
```

## Development

```bash
npm test
npm run build
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
