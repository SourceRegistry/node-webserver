import {
    createServer as createHttpServer,
    type Server as HttpServer,
    IncomingMessage,
    type ServerOptions,
    ServerResponse
} from 'http';
import {
    createServer as createHttpsServer,
    type Server as HttpsServer,
    type ServerOptions as HttpsServerOptions
} from 'https';
import {TLSSocket} from 'tls';
import {Readable, Transform, Writable} from 'stream';
import {
    type RequestEvent,
    Router
} from './';
import {isHttpError, isRedirect} from "../utils";
import {WebSocketServer, WebSocket} from "ws";
import {Cookies} from "./Cookies";
import {ListenOptions} from "net";

type HostMatcher = string | RegExp | ((host: string) => boolean);
type InferServerLocals<TServerConfig extends ServerConfig> =
    Extract<TServerConfig['locals'], (event: RequestEvent) => any> extends (event: RequestEvent) => infer TLocals
        ? TLocals extends App.Locals
            ? TLocals
            : App.Locals
        : App.Locals;
type ListenArgs =
    | [port?: number, hostname?: string, backlog?: number, listeningListener?: () => void]
    | [port?: number, hostname?: string, listeningListener?: () => void]
    | [port?: number, backlog?: number, listeningListener?: () => void]
    | [port?: number, listeningListener?: () => void]
    | [path: string, backlog?: number, listeningListener?: () => void]
    | [path: string, listeningListener?: () => void]
    | [options: ListenOptions, listeningListener?: () => void]
    | [handle: any, backlog?: number, listeningListener?: () => void]
    | [handle: any, listeningListener?: () => void];

class PayloadTooLargeError extends Error {
    readonly status = 413;

    constructor(message = 'Payload Too Large') {
        super(message);
        this.name = 'PayloadTooLargeError';
    }
}

export type SecurityConfig = {
    /**
     * Trust the incoming Host header when constructing event.url/request.url.
     * Disabled by default to avoid host header poisoning in absolute URL generation.
     */
    trustHostHeader?: boolean;

    /**
     * Restrict trusted Host values when trustHostHeader is enabled.
     */
    allowedHosts?: HostMatcher | HostMatcher[];

    /**
     * Restrict accepted WebSocket Origin values.
     * When omitted, Origin is not enforced by default.
     */
    allowedWebSocketOrigins?: HostMatcher | HostMatcher[];

    /**
     * Maximum accepted request body size based on Content-Length.
     * Requests above the limit are rejected before the body is read.
     */
    maxRequestBodySize?: number;

    /**
     * Maximum accepted WebSocket message size in bytes.
     * Passed to ws as maxPayload.
     */
    maxWebSocketPayload?: number;
};

export type HttpServerConfig = {
    type: 'http';
    options?: ServerOptions;
    security?: SecurityConfig;
};

export type HttpsServerConfig = {
    type: 'https';
    options: HttpsServerOptions;
    security?: SecurityConfig;
};

export type ServerConfig = {
    locals?: (event: RequestEvent) => App.Locals;
    platform?: (event: RequestEvent) => App.Platform;
} & (HttpServerConfig | HttpsServerConfig);

export class WebServer<TServerConfig extends ServerConfig = ServerConfig> extends Router<InferServerLocals<TServerConfig>> {
    private _server!: TServerConfig['type'] extends 'https' ? HttpsServer : HttpServer;
    private readonly config: TServerConfig;
    private upgradeHandlerInstalled = false;

    // Single WebSocket server instance
    private readonly wss: WebSocketServer;

    constructor(config?: TServerConfig) {
        super();
        this.config = (config ?? {type: 'http', options: {}}) as TServerConfig;
        this.wss = new WebSocketServer({
            noServer: true,
            maxPayload: this.config.security?.maxWebSocketPayload ?? 1024 * 1024
        });
    }

    private get server(): TServerConfig['type'] extends 'https' ? HttpsServer : HttpServer {
        if (!this._server) {
            const requestListener = (req: IncomingMessage, res: ServerResponse) => {
                this.handleRequest(req, res).catch(err => {
                    console.error('Unhandled request error:', err);
                    res.statusCode = 500;
                    res.end('Internal Server Error');
                });
            };

            // @ts-ignore
            this._server = this.config.type === 'https'
                ? createHttpsServer(this.config.options as HttpsServerOptions, requestListener)
                : createHttpServer(this.config.options as ServerOptions, requestListener);
        }
        return this._server;
    }

    listen(port?: number, hostname?: string, backlog?: number, listeningListener?: () => void): this;
    listen(port?: number, hostname?: string, listeningListener?: () => void): this;
    listen(port?: number, backlog?: number, listeningListener?: () => void): this;
    listen(port?: number, listeningListener?: () => void): this;
    listen(path: string, backlog?: number, listeningListener?: () => void): this;
    listen(path: string, listeningListener?: () => void): this;
    listen(options: ListenOptions, listeningListener?: () => void): this;
    listen(handle: any, backlog?: number, listeningListener?: () => void): this;
    listen(handle: any, listeningListener?: () => void): this;
    listen(...args: ListenArgs): this {
        if (!this.upgradeHandlerInstalled) {
            this.installUpgradeHandler();
            this.upgradeHandlerInstalled = true;
        }

        this.server.listen(...args);
        return this;
    }

    private installUpgradeHandler(): void {
        this.server.on('upgrade', (req, socket, head) => {
            if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
                socket.destroy();
                return;
            }

            let url: URL;
            let request: Request;
            try {
                url = this.toURL(req, true);
                request = this.toRequest(req, url, true);
            } catch {
                socket.destroy();
                return;
            }

            const event = this.toRequestEvent(request, url, {
                getClientAddress: () => req.socket.remoteAddress ?? '127.0.0.1',
                setHeader: () => {
                },
                pushSetCookie: () => {
                }
            });

            this.canHandleWebSocket(event)
                .then((canHandle) => {
                    if (!canHandle || !this.isAllowedWebSocketOrigin(req)) {
                        socket.destroy();
                        return;
                    }

                    this.wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
                        this.handleWebSocket(event, ws).then((handled) => {
                            if (!handled && ws.readyState === WebSocket.OPEN) {
                                ws.close(1008, 'Route not found');
                            }
                        }).catch(err => {
                            console.error('WebSocket routing error:', err);
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.close(1011, 'Internal error');
                            }
                        });
                    });
                })
                .catch(() => socket.destroy());
        });
    }

    close(callback?: (err?: Error) => void): void {
        this.wss.close(() => {
            this.server.close(callback);
        });
    }

    address(): string | import('net').AddressInfo | null {
        return this.server.address();
    }

    get listening(): boolean {
        return this.server.listening;
    }

    private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (!this.isRequestBodyAllowed(req)) {
            res.statusCode = 413;
            res.end('Payload Too Large');
            return;
        }

        const abortController = new AbortController();
        const abortRequest = () => abortController.abort();
        req.once('aborted', abortRequest);
        req.once('close', abortRequest);
        res.once('close', abortRequest);

        const request = this.toWebRequest(req, abortController.signal);
        const url = new URL(request.url);

        const setHeaders: Record<string, string> = {};
        const setCookies: string[] = [];

        const event = this.toRequestEvent(request, url, {
            getClientAddress: () => req.socket.remoteAddress ?? '127.0.0.1',
            setHeader: (name: string, value: string) => {
                setHeaders[name.toLowerCase()] = value;
            },
            pushSetCookie: (serialized: string) => {
                setCookies.push(serialized);
            }
        });

        let response: Response;
        try {
            response = await this.handle(event);
        } catch (err) {
            response = this.handleError(err);
        }

        for (const [name, value] of Object.entries(setHeaders)) {
            res.setHeader(name, value);
        }

        if (setCookies.length > 0) {
            res.setHeader('Set-Cookie', setCookies);
        }

        await this.sendWebResponse(res, response);
    }

    private toWebRequest(req: IncomingMessage, signal?: AbortSignal): Request {
        const url = this.toURL(req, false);
        return this.toRequest(req, url, false, signal);
    }

    private toRequest(req: IncomingMessage, url: URL, isWebSocket: boolean, signal?: AbortSignal): Request {
        const init: RequestInit = {
            method: isWebSocket ? 'GET' : req.method,
            headers: this.toHeaders(req.headers),
            signal,
            // @ts-ignore
            duplex: 'half'
        };

        if (!isWebSocket && req.method !== 'GET' && req.method !== 'HEAD') {
            init.body = Readable.toWeb(this.wrapRequestBody(req)) as unknown as ReadableStream<Uint8Array>;
        }

        return new Request(url, init);
    }

    private wrapRequestBody(req: IncomingMessage): Readable {
        const limit = this.config.security?.maxRequestBodySize;
        if (!limit) {
            return req;
        }

        let total = 0;
        const limiter = new Transform({
            transform(chunk, _encoding, callback) {
                total += Buffer.byteLength(chunk);
                if (total > limit) {
                    callback(new PayloadTooLargeError());
                    return;
                }

                callback(null, chunk);
            }
        });

        req.on('aborted', () => limiter.destroy(new Error('Request aborted')));
        req.on('error', (error) => limiter.destroy(error));
        req.pipe(limiter);
        return limiter;
    }

    private toURL(req: IncomingMessage, isWebSocket: boolean): URL {
        const protocol = req.socket instanceof TLSSocket ? (isWebSocket ? 'wss' : 'https') : (isWebSocket ? 'ws' : 'http');
        const authority = this.resolveAuthority(req);
        return new URL(req.url ?? '/', `${protocol}://${authority}`);
    }

    private resolveAuthority(req: IncomingMessage): string {
        const trustedAuthority = this.config.security?.trustHostHeader ? this.normalizeTrustedHost(req.headers.host) : null;
        if (trustedAuthority) {
            return trustedAuthority;
        }

        const address = this.server.address();
        if (address && typeof address === 'object') {
            const host = address.address.includes(':') ? `[${address.address}]` : address.address;
            return `${host}:${address.port}`;
        }

        return req.socket.localPort ? `127.0.0.1:${req.socket.localPort}` : 'localhost';
    }

    private normalizeTrustedHost(hostHeader: string | undefined): string | null {
        if (!hostHeader) return null;

        let url: URL;
        try {
            url = new URL(`http://${hostHeader}`);
        } catch {
            return null;
        }

        if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
            return null;
        }

        const authority = url.port ? `${url.hostname}:${url.port}` : url.hostname;
        const allowedHosts = this.config.security?.allowedHosts;
        if (!allowedHosts || this.matchesValue(authority, allowedHosts)) {
            return authority;
        }

        return null;
    }

    private matchesValue(value: string, matcher: HostMatcher | HostMatcher[]): boolean {
        const matchers = Array.isArray(matcher) ? matcher : [matcher];
        return matchers.some((entry) => {
            if (typeof entry === 'string') return entry === value;
            if (entry instanceof RegExp) return entry.test(value);
            return entry(value);
        });
    }

    private toHeaders(headers: IncomingMessage['headers']): Headers {
        const normalized = new Headers();
        for (const [name, value] of Object.entries(headers)) {
            if (value === undefined) continue;

            if (Array.isArray(value)) {
                const joined = name.toLowerCase() === 'cookie' ? value.join('; ') : value.join(', ');
                normalized.set(name, joined);
                continue;
            }

            normalized.set(name, value);
        }

        return normalized;
    }

    private isRequestBodyAllowed(req: IncomingMessage): boolean {
        const limit = this.config.security?.maxRequestBodySize;
        if (!limit) return true;

        const contentLength = req.headers['content-length'];
        if (!contentLength) return true;

        const parsed = Number.parseInt(Array.isArray(contentLength) ? contentLength[0] : contentLength, 10);
        return Number.isFinite(parsed) && parsed <= limit;
    }

    private handleError(err: unknown): Response {
        if (err instanceof PayloadTooLargeError) {
            return new Response(err.message, {status: err.status});
        }

        if (isHttpError(err)) {
            return new Response(JSON.stringify({
                error: err.statusText || 'Error',
                status: err.status
            }), {
                status: err.status,
                headers: {'Content-Type': 'application/json'}
            });
        }

        if (isRedirect(err)) {
            const location = err.headers.get('Location') || '/';
            return new Response(null, {
                status: err.status,
                headers: {'Location': location}
            });
        }

        console.error('Unhandled error:', err);
        return new Response('Internal Server Error', {status: 500});
    }

    private async sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });

        if (!res.hasHeader('Server')) {
            res.setHeader('Server', 'WebHTTPServer');
        }

        if (!response.body || this.shouldOmitResponseBody(response, res.req?.method)) {
            res.end();
            return;
        }

        const reader = response.body.getReader();
        const writer = Writable.toWeb(res).getWriter();
        let streamClosed = false;

        const cancelReader = async () => {
            if (streamClosed) return;
            streamClosed = true;
            await reader.cancel().catch(() => {
            });
        };
        const onResponseClose = () => {
            void cancelReader();
        };
        res.once('close', onResponseClose);

        try {
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                await writer.write(value);
            }
            streamClosed = true;
        } catch (err) {
            await cancelReader();

            if (!this.isPrematureCloseError(err)) {
                throw err;
            }
        } finally {
            res.off('close', onResponseClose);
            await writer.close().catch(() => {
            });
        }
    }

    private isPrematureCloseError(err: unknown): boolean {
        if (!(err instanceof Error)) return false;

        const code = 'code' in err ? err.code : undefined;
        if (code === 'ABORT_ERR' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
            return true;
        }

        return err.name === 'AbortError';
    }

    private shouldOmitResponseBody(response: Response, method?: string): boolean {
        if (method === 'HEAD') return true;
        return response.status === 204 || response.status === 205 || response.status === 304;
    }

    private isAllowedWebSocketOrigin(req: IncomingMessage): boolean {
        const origin = req.headers.origin;
        if (!origin) return true;

        const allowedOrigins = this.config.security?.allowedWebSocketOrigins;
        if (!allowedOrigins) return true;

        return this.matchesValue(origin, allowedOrigins);
    }

    private createEventFetch(
        parentEvent: RequestEvent,
        utils: {
            getClientAddress: () => string;
            setHeader: (name: string, value: string) => void;
            pushSetCookie: (serialized: string) => void;
        }
    ): typeof fetch {
        return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = this.toEventFetchRequest(parentEvent, input, init);
            if (request.url.startsWith(`${parentEvent.url.origin}/`)) {
                const internalEvent = this.toRequestEvent(request, new URL(request.url), utils);

                try {
                    return await this.handle(internalEvent);
                } catch (err) {
                    return this.handleError(err);
                }
            }

            return fetch(request);
        };
    }

    private toEventFetchRequest(parentEvent: RequestEvent, input: RequestInfo | URL, init?: RequestInit): Request {
        const requestLike = input instanceof URL
            ? input.toString()
            : input;

        const baseRequest = requestLike instanceof Request
            ? requestLike
            : new Request(new URL(String(requestLike), parentEvent.url), init);

        if (requestLike instanceof Request && !init) {
            return this.withInheritedRequestHeaders(parentEvent, requestLike);
        }

        const headers = new Headers(requestLike instanceof Request ? requestLike.headers : init?.headers);
        const method = init?.method ?? (requestLike instanceof Request ? requestLike.method : undefined);
        const body = init?.body ?? (requestLike instanceof Request ? requestLike.body : undefined);
        const duplex = body ? 'half' : undefined;

        this.inheritRequestHeader(parentEvent.request.headers, headers, 'cookie');
        this.inheritRequestHeader(parentEvent.request.headers, headers, 'authorization');

        return new Request(baseRequest.url, {
            ...init,
            method,
            headers,
            body,
            signal: init?.signal ?? parentEvent.request.signal,
            // @ts-ignore
            duplex
        });
    }

    private withInheritedRequestHeaders(parentEvent: RequestEvent, request: Request): Request {
        const headers = new Headers(request.headers);
        this.inheritRequestHeader(parentEvent.request.headers, headers, 'cookie');
        this.inheritRequestHeader(parentEvent.request.headers, headers, 'authorization');

        return new Request(request, {
            headers,
            signal: parentEvent.request.signal,
            // @ts-ignore
            duplex: request.body ? 'half' : undefined
        });
    }

    private inheritRequestHeader(source: Headers, target: Headers, name: string): void {
        if (target.has(name)) return;

        const value = source.get(name);
        if (value) {
            target.set(name, value);
        }
    }

    private toRequestEvent(
        request: Request,
        url: URL,
        utils: {
            getClientAddress: () => string;
            setHeader: (name: string, value: string) => void;
            pushSetCookie: (serialized: string) => void;
        }
    ): RequestEvent<{}> {
        const cookies = new Cookies(request, utils.pushSetCookie);
        const handlers = this.config;
        const locals: App.Locals = {} as App.Locals;
        const platform: App.Platform | Record<string, any> = {name: 'WebHTTPServer'};
        const setHeadersState = new Set<string>();

        const event: RequestEvent<{}> = {
            request,
            url,
            cookies,
            getClientAddress: utils.getClientAddress,
            get locals(): App.Locals {
                return locals;
            },
            get platform(): App.Platform | undefined {
                return platform;
            },
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => eventFetch(input, init),
            params: {},
            route: {id: null},
            setHeaders: (headers: Record<string, string>) => {
                for (const [name, value] of Object.entries(headers)) {
                    const normalizedName = name.toLowerCase();
                    if (normalizedName === 'set-cookie') {
                        throw new TypeError('Use event.cookies for Set-Cookie headers');
                    }
                    if (setHeadersState.has(normalizedName)) {
                        throw new TypeError(`Header "${name}" has already been set`);
                    }
                    setHeadersState.add(normalizedName);
                    utils.setHeader(name, value);
                }
            }
        };
        const eventFetch = this.createEventFetch(event, utils);

        if (handlers.locals) {
            Object.assign(locals, handlers.locals(event));
        }
        if (handlers.platform) {
            Object.assign(platform as Record<string, any>, handlers.platform(event));
        }

        return event;
    }
}
