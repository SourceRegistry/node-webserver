<div align="center">

# @sourceregistry/node-webserver

**TypeScript web server for Node.js built on the web-standard `Request` and `Response` APIs**

[![npm version](https://img.shields.io/npm/v/@sourceregistry/node-webserver?style=flat-square&color=f96743)](https://www.npmjs.com/package/@sourceregistry/node-webserver)
[![npm downloads](https://img.shields.io/npm/dm/@sourceregistry/node-webserver?style=flat-square)](https://www.npmjs.com/package/@sourceregistry/node-webserver)
[![JSR](https://jsr.io/badges/@sourceregistry/node-webserver?style=flat-square)](https://jsr.io/@sourceregistry/node-webserver)
[![license](https://img.shields.io/npm/l/@sourceregistry/node-webserver?style=flat-square)](./LICENSE)
[![node](https://img.shields.io/node/v/@sourceregistry/node-webserver?style=flat-square&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![CI](https://img.shields.io/github/actions/workflow/status/SourceRegistry/node-webserver/ci.yml?style=flat-square&label=CI)](https://github.com/SourceRegistry/node-webserver/actions/workflows/ci.yml)
[![issues](https://img.shields.io/github/issues/SourceRegistry/node-webserver?style=flat-square)](https://github.com/SourceRegistry/node-webserver/issues)

Typed router · Middleware · Route enhancers · WebSockets · SSE · Static files · CORS · Rate limiting · Security headers

[Docs](https://sourceregistry.github.io/node-webserver/) · [npm](https://www.npmjs.com/package/@sourceregistry/node-webserver) · [JSR](https://jsr.io/@sourceregistry/node-webserver) · [Issues](https://github.com/SourceRegistry/node-webserver/issues)

</div>

---

## Features

- Typed router with path params and nested routers
- Middleware with short-circuit support
- Route enhancers for typed request-scoped context
- Router lifecycle hooks — `pre()` and `post()`
- WebSocket routing with enhancer support
- Server-Sent Events via `sse()`
- Cookie helpers
- Static file serving with path traversal protection
- Built-in middleware: CORS, rate limiting, security headers, request IDs, timeouts
- HTTPS support
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
app.GET("/health", () => json({ ok: true }));

app.listen(3000, () => console.log("listening on http://127.0.0.1:3000"));
```

## Overview

```ts
import {
  WebServer, Router, enhance, json, text, html, sse,
  CORS, RateLimiter, RequestId, Security, Timeout,
  error, redirect
} from "@sourceregistry/node-webserver";

const app = new WebServer({
  locals: (event) => ({ requestId: crypto.randomUUID() }),
  security: { trustedProxies: ["127.0.0.1"], maxRequestBodySize: 1024 * 1024 }
});

// Built-in middleware
app.useMiddleware(RequestId.assign());
app.useMiddleware(Security.headers());
app.useMiddleware(CORS.policy({ origin: ["https://app.example.com"], credentials: true }));
app.useMiddleware(RateLimiter.slidingWindowLimit({ windowMs: 60_000, max: 100 }));
app.useMiddleware(Timeout.deadline({ ms: 5000 }));

// Typed route enhancers
const withAuth = async (event) => {
  const token = event.request.headers.get("authorization");
  if (!token) error(401, { message: "Unauthorized" });
  return { user: await verifyToken(token) };
};

app.GET("/me", enhance(
  async (event) => json(event.context.user),
  withAuth,
));

// Nested routers
const api = new Router();
api.GET("/status", () => json({ ok: true }));
app.use("/api", api);

app.listen(3000);
```

---

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
app.use(api);
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

It also exports `sse()` for Server-Sent Events. The helper creates a streaming response and passes your callback an `emit()` function. You can also pass a `ResponseInit` object to override status or headers.

```ts
import { sse } from "@sourceregistry/node-webserver";

app.GET("/events", sse((event, emit) => {
  emit({ connected: true }, { event: "ready", id: "1" });
  emit(`hello ${event.getClientAddress()}`);
}, {
  status: 200,
  headers: {
    "x-stream": "enabled"
  }
}));
```

`emit(data, options)` supports:

- `event` for the SSE event name
- `id` for the SSE event id
- `retry` for the reconnection delay
- `comment` for SSE comment lines

Objects are serialized as JSON automatically. Strings are sent as plain `data:` lines.

If the callback finishes without returning cleanup, the SSE stream closes automatically. If it returns a cleanup function, the stream stays open until the client disconnects or the stream is canceled.

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
- `event.fetch(...)`
- `event.params`
- `event.locals`
- `event.platform`
- `event.cookies`
- `event.getClientAddress()`
- `event.setHeaders(...)`

`event.fetch(...)` is a server-aware variant of the native Fetch API:

- it resolves relative URLs against the current request URL
- it forwards `cookie` and `authorization` headers by default
- it dispatches same-origin requests internally through the router when possible

```ts
app.GET("/posts", async (event) => {
  const response = await event.fetch("/api/posts");
  return new Response(await response.text(), {
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/plain"
    }
  });
});
```

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

## Built-in Middleware

The library exports built-in middleware namespaces from `@sourceregistry/node-webserver`:

- `CORS`
- `RateLimiter`
- `RequestId`
- `Security`
- `Timeout`

### Security headers

Use `Security.headers()` to apply a small set of secure defaults without overwriting headers your route already sets.

```ts
import { Security } from "@sourceregistry/node-webserver";

app.useMiddleware(Security.headers());
```

By default it adds:

- `Content-Security-Policy`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`

You can disable or override individual headers:

```ts
app.useMiddleware(Security.headers({
  contentSecurityPolicy: false,
  frameOptions: "SAMEORIGIN",
  strictTransportSecurity: "max-age=31536000; includeSubDomains"
}));
```

### Request IDs

Use `RequestId.assign()` to accept or generate a request ID, expose it through `event.locals.requestId`, and add it to the response.

```ts
import { RequestId } from "@sourceregistry/node-webserver";

app.useMiddleware(RequestId.assign());
```

You can customize the header name or generator:

```ts
app.useMiddleware(RequestId.assign({
  headerName: "x-correlation-id",
  generate: () => crypto.randomUUID()
}));
```

### Timeouts

Use `Timeout.deadline()` to return a fallback response when a route takes too long.

```ts
import { Timeout } from "@sourceregistry/node-webserver";

app.useMiddleware(Timeout.deadline({
  ms: 5000
}));
```

You can customize the response and add a timeout hook:

```ts
app.useMiddleware(Timeout.deadline({
  ms: 2000,
  status: 503,
  body: "Request timed out",
  onTimeout: () => {
    console.warn("request exceeded deadline");
  }
}));
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

## Route Enhancers

Use `enhance()` when you want to derive typed request-scoped data for a single handler without putting everything on `event.locals`.

Each enhancer receives the normal request event and can:

- return an object to merge into `event.context`
- return `undefined` to contribute nothing
- return a `Response` to short-circuit the route early
- throw `error(...)`, `redirect(...)`, or `new Response(...)` for the same control flow used elsewhere in the router

```ts
import { enhance, error } from "@sourceregistry/node-webserver";

app.GET("/admin", enhance(
  async (event) => {
    return new Response(JSON.stringify({
      userId: event.context.user.id,
      requestId: event.context.requestId
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  },
  async (event) => {
    const token = event.request.headers.get("authorization");
    if (!token) {
      error(401, { message: "Unauthorized" });
    }

    return {
      user: { id: "u_1", role: "admin" }
    };
  },
  async (event) => {
    return {
      requestId: event.locals.requestId
    };
  }
));
```

### Typed enhancers

You can define reusable enhancers with the `EventEnhancer` type. The fifth type parameter (`TExtra`) controls whether the enhancer receives extra event properties like `websocket`.

Without WebSocket — works in any HTTP route:

```ts
import type { EventEnhancer } from "@sourceregistry/node-webserver";

const withAuth: EventEnhancer<any, any, App.Locals, { user: { id: string; role: string } }> = async (event) => {
  const token = event.request.headers.get("authorization");
  if (!token) error(401, { message: "Unauthorized" });
  return { user: await verifyToken(token) };
};
```

With WebSocket — only usable in `router.WS()` routes:

```ts
import type { EventEnhancer } from "@sourceregistry/node-webserver";
import type { WebSocket } from "ws";

const withWsAuth: EventEnhancer<any, any, App.Locals, { user: { id: string } }, { websocket: WebSocket }> = async (event) => {
  // event.websocket is available here
  const token = event.request.headers.get("authorization");
  if (!token) error(401, { message: "Unauthorized" });
  return { user: await verifyToken(token) };
};

router.WS("/ws/chat", enhance(
  async ({ context, websocket }) => {
    websocket.send(`hello ${context.user.id}`);
  },
  withWsAuth
));
```

Plain HTTP enhancers (`TExtra = {}`) can still be passed to a WS `enhance()` call — they just won't have access to `websocket`.

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

`enhance()` works with WebSocket handlers too. When your handler includes `websocket` in the event type, the returned function requires it automatically:

```ts
import { enhance, error } from "@sourceregistry/node-webserver";

app.WS("/ws/chat/[room]", enhance(
  async ({ context, params, websocket }) => {
    websocket.send(`joined:${params.room} as ${context.user.id}`);

    websocket.on("message", (message) => {
      websocket.send(`echo:${message.toString()}`);
    });
  },
  async (event) => {
    const token = event.request.headers.get("authorization");
    if (!token) {
      error(401, { message: "Unauthorized" });
    }

    return { user: { id: "u_1", role: "member" } };
  }
));
```

If an enhancer returns a `Response` (or throws via `error()`), the WebSocket handler is skipped and the connection closes.

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
    headersTimeoutMs: 30_000,
    requestTimeoutMs: 60_000,
    keepAliveTimeoutMs: 5_000,
    maxWebSocketPayload: 64 * 1024,
    trustedProxies: ["127.0.0.1"],
    trustHostHeader: true,
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
- `trustedProxies`
- `allowedWebSocketOrigins`
- `maxRequestBodySize`
- `headersTimeoutMs`
- `requestTimeoutMs`
- `keepAliveTimeoutMs`
- `maxWebSocketPayload`

`trustHostHeader` defaults to `false`. That is the safer default for public-facing services unless you are explicitly validating proxy behavior.

`trustedProxies` is also disabled by default. When configured, the server will trust `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` only when the direct peer matches one of the configured values.

For public-facing services, the server now also applies conservative timeout defaults unless you override them:

- `headersTimeoutMs`: `30000`
- `requestTimeoutMs`: `60000`
- `keepAliveTimeoutMs`: `5000`

### Middleware examples

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

The library provides two rate limiter algorithms:

#### Fixed Window (default)

```ts
import { RateLimiter } from "@sourceregistry/node-webserver";

app.useMiddleware(RateLimiter.fixedWindowLimit({
  windowMs: 60_000,
  max: 100
}));
```

#### Sliding Window

More accurate than fixed window as it tracks individual request timestamps. Uses more memory but avoids the "cliff" effect where all requests at the end of one window and start of next are counted together.

```ts
import { RateLimiter } from "@sourceregistry/node-webserver";

app.useMiddleware(RateLimiter.slidingWindowLimit({
  windowMs: 60_000,
  max: 100
}));
```

Both limiters support the same options:

- `windowMs`: Window duration in milliseconds (default: 60_000)
- `max`: Maximum requests per window
- `key`: Function to generate key (default: IP address)
- `message`: Custom error message
- `statusCode`: HTTP status code (default: 429)
- `headers`: Include or remove rate limit headers (default: 'include')
- `onRateLimit`: Callback when rate limit is hit
- `store`: Custom storage backend

The `onRateLimit` callback receives additional metadata:

```ts
RateLimiter.fixedWindowLimit({
  max: 300,
  windowMs: 60_000,
  onRateLimit: (event, info) => {
    event.setHeaders({
      "X-RateLimit-Limit": info.max.toString(),
      "X-RateLimit-Remaining": info.remaining.toString(),
      "X-RateLimit-Reset": info.reset.toString(),
      "Retry-After": Math.ceil(info.resetTimeMs / 1000).toString()
    });
  }
});
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

For a production-oriented baseline with:

- trusted proxy handling
- security headers
- request IDs
- route deadlines
- CORS and rate limiting

see [examples/public-baseline.ts](./examples/public-baseline.ts).

---

## Development

```bash
npm test            # run tests
npm run test:ui     # vitest UI
npm run test:coverage
npm run build
npm run docs:build  # generate TypeDoc
```

---

## License

[Apache-2.0](./LICENSE) © [Alexander Slaa](https://github.com/SourceRegistry)
