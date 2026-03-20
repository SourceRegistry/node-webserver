import {
    CORS,
    RequestId,
    RateLimiter,
    Security,
    Timeout,
    WebServer,
    json,
    text
} from "../src";

const app = new WebServer({
    type: "http",
    options: {},
    locals: () => ({
        startedAt: Date.now()
    }),
    security: {
        trustedProxies: ["127.0.0.1"],
        trustHostHeader: true,
        allowedHosts: ["app.example.com"],
        headersTimeoutMs: 30_000,
        requestTimeoutMs: 60_000,
        keepAliveTimeoutMs: 5_000,
        maxRequestBodySize: 1024 * 1024,
        allowedWebSocketOrigins: "https://app.example.com"
    }
});

app.pre(async (event) => {
    if (event.url.pathname.startsWith("/private")) {
        const auth = event.request.headers.get("authorization");
        if (!auth) {
            return new Response("Unauthorized", {status: 401});
        }
    }
});

app.useMiddleware(
    RequestId.assign(),
    Security.headers({
        strictTransportSecurity: "max-age=31536000; includeSubDomains"
    }),
    Timeout.deadline({
        ms: 15_000,
        status: 503,
        body: "Request timed out"
    }),
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

app.GET("/users/[id]", (event) => json({
    id: event.params.id,
    requestId: event.locals.requestId,
    startedAt: event.locals.startedAt
}));

app.post(async (_event, response) => {
    const nextResponse = new Response(response.body, response);
    nextResponse.headers.set("x-server", "node-webserver");
    return nextResponse;
});

app.listen(3000, () => {
    console.log("server listening on port 3000");
});
