import type {RequestEvent} from "./RequestEvent";
import {RequestMethod, RequestMethods} from "./RequestMethod";
import {isHttpError, isRedirect, isResponse} from "../utils";
import {WebSocket} from "ws";
import type {MaybePromise} from "./MaybePromise";

/**
 * Extracts path parameters from route pattern
 * - [param] → string
 * - [...param] → string (full path segment, e.g. "a/b/c")
 * - [[param]] → string | '' (optional segment)
 */
export type ExtractPathParams<T extends string> =
    T extends `/${infer Segment}/${infer Rest}`
        ? MergeParams<ExtractSegmentParam<Segment>, ExtractPathParams<`/${Rest}`>>
        : T extends `/${infer Segment}`
            ? ExtractSegmentParam<Segment>
            : {};

export type ExtractSegmentParam<S extends string> =
    S extends `[...${infer Param}]` ? { [K in Param]: string } :
        S extends `[[${infer Param}]]` ? { [K in Param]?: string } :
            S extends `[${infer Param}]` ? { [K in Param]: string } :
                {};

export type MergeParams<A, B> = A & B;

// Add Locals generic
export type RouteHandler<Path extends string, Locals extends Record<string, any> = {}> = (
    event: RequestEvent<
        ExtractPathParams<Path> & RequestEvent['params'],
        Path,
        Locals
    >
) => MaybePromise<Response>;

export type ActionHandler<Path extends string, OutputData extends Record<string, any> = Record<string, any>> = Action<ExtractPathParams<Path>, OutputData>;

export type Action<
    Params extends Partial<Record<string, string>> = Partial<Record<string, string>>,
    OutputData extends Record<string, any> | void = Record<string, any> | void,
> = (event: RequestEvent<Params>) => MaybePromise<OutputData>;

// Middleware with locals support
export type Middleware<
    Path extends string = string,
    AddedLocals extends Record<string, any> = {}
> = (
    event: RequestEvent<any, Path, any> & { locals: Record<string, any> & AddedLocals },
    next: () => MaybePromise<Response | undefined>
) => MaybePromise<Response | undefined>;

export type PreHandler<Locals extends Record<string, any> = {}> = (
    event: RequestEvent<any, string, Locals>
) => MaybePromise<Response | void>;

export type PostHandler<Locals extends Record<string, any> = {}> = (
    event: RequestEvent<any, string, Locals>,
    response: Response
) => MaybePromise<Response | void>;

// WebSocket Handler
export type WebSocketHandler<Path extends string, Locals extends Record<string, any> = {}> = (
    event: RequestEvent<
        ExtractPathParams<Path> & RequestEvent['params'],
        Path,
        Locals
    > & { websocket: WebSocket }
) => MaybePromise<any>;

// Route definition
export interface Route<Path extends string> {
    readonly path: Path;
    readonly method: RequestMethod;
    readonly regex: RegExp;
    readonly paramNames: readonly string[];
    readonly isCatchAll: boolean;
    readonly priority: number;
    readonly handler: RouteHandler<Path, any>;
    readonly middlewares: Middleware<Path>[];
}

type WebSocketRoute<Path extends string> = {
    readonly path: Path;
    readonly regex: RegExp;
    readonly paramNames: readonly string[];
    readonly isCatchAll: boolean;
    readonly priority: number;
    readonly handler: WebSocketHandler<Path, any>;
    readonly middlewares: Middleware<Path>[];
};

// Nested router
interface NestedRouter {
    readonly prefix: string;
    readonly router: Router<any>;
    readonly regex: RegExp;
    readonly paramNames: readonly string[];
    readonly isCatchAll: boolean;
    readonly priority: number;
    readonly middlewares: Middleware<any>[];
}

// Cache for regex creation
class PathRegexCache {
    private static cache = new Map<string, {
        regex: RegExp;
        paramNames: string[];
        isCatchAll: boolean;
        priority: number;
    }>();

    static get(path: string) {
        return this.cache.get(path);
    }

    static set(path: string, value: {
        regex: RegExp;
        paramNames: string[];
        isCatchAll: boolean;
        priority: number;
    }) {
        this.cache.set(path, value);
    }
}

export class Router<Locals extends App.Locals = App.Locals> {
    private _routes: Route<any>[] = [];
    private _wsRoutes: WebSocketRoute<any>[] = [];
    private _nestedRouters: NestedRouter[] = [];
    private _middlewares: Middleware<string, any>[] = [];
    private _preHandlers: PreHandler<Locals>[] = [];
    private _postHandlers: PostHandler<Locals>[] = [];
    private routesSorted = false;
    private wsRoutesSorted = false;

    get routes(): readonly Route<any>[] {
        return this._routes;
    }

    get nestedRouters(): readonly NestedRouter[] {
        return this._nestedRouters;
    }

    // HTTP method handlers
    GET<Path extends string>(
        path: Path,
        handler: RouteHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        return this.addHandler('GET', path, handler, middlewares);
    }

    POST<Path extends string>(
        path: Path,
        handler: RouteHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        return this.addHandler('POST', path, handler, middlewares);
    }

    PUT<Path extends string>(
        path: Path,
        handler: RouteHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        return this.addHandler('PUT', path, handler, middlewares);
    }

    PATCH<Path extends string>(
        path: Path,
        handler: RouteHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        return this.addHandler('PATCH', path, handler, middlewares);
    }

    DELETE<Path extends string>(
        path: Path,
        handler: RouteHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        return this.addHandler('DELETE', path, handler, middlewares);
    }

    HEAD<Path extends string>(
        path: Path,
        handler: RouteHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        return this.addHandler('HEAD', path, handler, middlewares);
    }

    OPTIONS<Path extends string>(
        path: Path,
        handler: RouteHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        return this.addHandler('OPTIONS', path, handler, middlewares);
    }

    // Universal method
    USE<Path extends string>(
        path: Path,
        handler: RouteHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        RequestMethods.forEach(method => this.addHandler(method, path, handler, middlewares));
        return this;
    }

    // Action handler (POST only)
    action<Path extends string, OutputData extends Record<string, any> = Record<string, any>>(
        path: Path,
        handler: ActionHandler<Path, OutputData>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        const wrapped: RouteHandler<Path, Locals> = async (event) => {
            try {
                const result = await handler(event as RequestEvent<ExtractPathParams<Path>, Path, Locals>);
                return this.formatActionResult(result);
            } catch (error) {
                return this.handleActionError(error);
            }
        };

        return this.addHandler('POST', path, wrapped, middlewares);
    }

    // Nested routing
    use<Prefix extends string, InnerLocals extends Record<string, any>>(input: readonly [Prefix, Router<InnerLocals>, ...Middleware<Prefix>[]]): Router<Locals & InnerLocals>;
    use<Prefix extends string, InnerLocals extends Record<string, any>>(prefix: Prefix, router: Router<InnerLocals>, ...middlewares: Middleware<Prefix>[]): Router<Locals & InnerLocals>;
    use<Prefix extends string, InnerLocals extends Record<string, any>>(arg1: string | readonly [Prefix, Router<InnerLocals>, ...Middleware<Prefix>[]], arg2?: Router<InnerLocals>, ...middlewares: Middleware<Prefix>[]): Router<Locals & InnerLocals> {
        let prefix: Prefix;
        let router: Router<InnerLocals>;
        let finalMiddlewares: Middleware<Prefix>[] = middlewares;

        if (Array.isArray(arg1)) {
            [prefix, router] = arg1;
            finalMiddlewares = arg1.length > 2 ? arg1.slice(2) as Middleware<Prefix>[] : [];
        } else {
            prefix = arg1 as Prefix;
            router = arg2!;
        }

        const normalizedPrefix = this.normalizePrefix(prefix);
        const {regex, paramNames, isCatchAll, priority} = this.createPrefixRegex(normalizedPrefix);

        this._nestedRouters.push({
            prefix: normalizedPrefix,
            router,
            regex,
            paramNames,
            isCatchAll,
            priority,
            middlewares: finalMiddlewares
        });

        return this as unknown as Router<Locals & InnerLocals>;
    }

    // Global middleware
    useMiddleware<NewLocals extends Record<string, any>>(
        ...mw: Middleware<string, NewLocals>[]
    ): Router<Locals & NewLocals> {
        this._middlewares.push(...mw);
        return this as unknown as Router<Locals & NewLocals>;
    }

    pre(...handlers: PreHandler<Locals>[]): Router<Locals> {
        this._preHandlers.push(...handlers);
        return this;
    }

    post(...handlers: PostHandler<Locals>[]): Router<Locals> {
        this._postHandlers.push(...handlers);
        return this;
    }

    // Discard routes or nested routers
    discard(path_or_prefix: string, method?: RequestMethod): this {
        this._nestedRouters = this._nestedRouters.filter(r => r.prefix !== path_or_prefix);
        this._routes = this._routes.filter(route =>
            route.path !== path_or_prefix || (method && route.method !== method)
        );
        return this;
    }

    // WebSocket route
    WS<Path extends string>(
        path: Path,
        handler: WebSocketHandler<Path, Locals>,
        ...middlewares: Middleware<Path, any>[]
    ): Router<Locals> {
        const {regex, paramNames, isCatchAll, priority} = this.createPathRegex(path);

        this._wsRoutes.push({
            path,
            regex,
            paramNames,
            isCatchAll,
            priority,
            handler,
            middlewares
        });

        this.wsRoutesSorted = false;
        return this;
    }

    // Add this method to your Router class

    /**
     * Check if the router can handle a WebSocket connection for the given path
     * This is used during the upgrade process to validate routes before attempting connection
     */
    public async canHandleWebSocket(event: RequestEvent): Promise<boolean> {
        return this.canHandleWebSocketAtPath(event, event.url.pathname);
    }

    private async canHandleWebSocketAtPath(event: RequestEvent, pathname: string): Promise<boolean> {
        if (!this.wsRoutesSorted) this.sortWsRoutes();

        // 1. Check nested routers first
        for (const nested of [...this._nestedRouters].sort((a, b) => b.priority - a.priority)) {
            const match = pathname.match(nested.regex);
            if (!match || match.index !== 0) continue;

            const matched = match[0];
            const remaining = pathname.slice(matched.length) || '/';

            const nestedEvent: RequestEvent = {
                ...event,
                params: {...event.params, ...this.extractPrefixParams(nested, matched)}
            };

            // Recursively check if nested router can handle the WebSocket
            if (await nested.router.canHandleWebSocketAtPath(nestedEvent, remaining)) {
                return true;
            }
        }

        // 2. Check local WebSocket routes
        for (const route of this._wsRoutes) {
            if (route.regex.test(pathname)) {
                return true;
            }
        }

        return false;
    }

    // Handle WebSocket upgrade
    public async handleWebSocket(
        event: RequestEvent,
        websocket: WebSocket
    ): Promise<boolean> {
        return this.handleWebSocketAtPath(event, websocket, event.url.pathname);
    }

    private async handleWebSocketAtPath(
        event: RequestEvent,
        websocket: WebSocket,
        pathname: string
    ): Promise<boolean> {
        if (!this.wsRoutesSorted) this.sortWsRoutes();

        // 1. Try nested routers
        for (const nested of [...this._nestedRouters].sort((a, b) => b.priority - a.priority)) {
            const match = pathname.match(nested.regex);
            if (!match || match.index !== 0) continue;

            const matched = match[0];
            const remaining = pathname.slice(matched.length) || '/';
            const prefixParams = this.extractPrefixParams(nested, matched);

            const nestedEvent: RequestEvent = {
                ...event,
                params: {...event.params, ...prefixParams}
            };

            const effectiveMiddlewares = [...this._middlewares, ...nested.middlewares];
            const handler = () => nested.router.handleWebSocketAtPath(nestedEvent, websocket, remaining);

            const result = await this.applyMiddlewaresWithList(nestedEvent, effectiveMiddlewares, handler as any);
            if (!result) continue;
            else return true;
        }

        // 2. Try local WebSocket routes
        for (const route of this._wsRoutes) {
            if (!route.regex.test(pathname)) continue;

            const match = pathname.match(route.regex);
            if (!match) continue;

            const params = Object.fromEntries(
                route.paramNames.map((name, i) => [name, match[i + 1] || ''])
            );

            const enhancedEvent = {
                ...event,
                params: {...event.params, ...params},
                route: {...event.route, id: route.path},
                websocket,
            }

            const allMiddlewares = [...this._middlewares, ...route.middlewares];


            const result = await this.applyMiddlewaresWithList(enhancedEvent, allMiddlewares, () => route.handler(enhancedEvent));
            if (result === undefined) {
                return true;
            }
        }

        return false;
    }

    // Handle HTTP request - FIXED: Single middleware application
    protected async handle(event: RequestEvent): Promise<Response> {
        return this.handleAtPath(event, event.url.pathname);
    }

    private async handleAtPath(event: RequestEvent, path: string): Promise<Response> {
        try {
            const method = event.request.method as RequestMethod;
            let response = await this.runPreHandlers(event);
            if (!response) {
                // Apply global middlewares once at the top level
                const handler = async () => {
                    // Try nested routers first
                    const nestedResponse = await this.handleNestedRouters(event, path);
                    if (nestedResponse) return nestedResponse;

                    // Then try local routes
                    if (!this.routesSorted) this.sortRoutes();
                    return this.handleLocalRoutes(event, method, path);
                };

                response = await this.applyMiddlewaresWithList(event, this._middlewares, handler);
            }

            const finalResponse = response || new Response("No Content", {status: 204});
            return await this.runPostHandlers(event, finalResponse);
        } catch (err) {
            if (isResponse(err)) return err;
            throw err;
        }
    }

    // Apply middlewares utility
    private async applyMiddlewaresWithList(
        event: RequestEvent,
        mws: Middleware<string, any>[],
        next: () => MaybePromise<Response | undefined>
    ) {
        const chain = [...mws];
        const run = async (index: number): Promise<Response | undefined> => {
            if (index >= chain.length) return next();
            return chain[index](event, () => run(index + 1));
        };
        return run(0);
    }

    private async runPreHandlers(event: RequestEvent): Promise<Response | undefined> {
        for (const handler of this._preHandlers) {
            const response = await handler(event as RequestEvent<any, string, Locals>);
            if (response instanceof Response) {
                return response;
            }
        }

        return undefined;
    }

    private async runPostHandlers(event: RequestEvent, response: Response): Promise<Response> {
        let currentResponse = response;

        for (const handler of this._postHandlers) {
            const nextResponse = await handler(event as RequestEvent<any, string, Locals>, currentResponse);
            if (nextResponse instanceof Response) {
                currentResponse = nextResponse;
            }
        }

        return currentResponse;
    }

    // Add route handler
    private addHandler<Path extends string>(
        method: RequestMethod,
        path: Path,
        handler: RouteHandler<Path, Locals>,
        middlewares: Middleware<Path, any>[] = []
    ): Router<Locals> {
        const {regex, paramNames, isCatchAll, priority} = this.createPathRegex(path);

        this._routes.push({
            method,
            path,
            regex,
            paramNames,
            isCatchAll,
            priority,
            handler,
            middlewares
        });

        this.routesSorted = false;
        return this;
    }

    // Create regex for route path
    private createPathRegex(path: string) {
        const cached = PathRegexCache.get(path);
        if (cached) return cached;

        const paramNames: string[] = [];
        let isCatchAll = false;
        let priority: number;

        const segments = path.split('/').filter(Boolean);
        priority = segments.reduce((acc, segment) => {
            if (segment.startsWith('[...')) return acc - 10;
            if (segment.startsWith('[[')) return acc - 5;
            if (segment.startsWith('[')) return acc - 1;
            return acc + 1;
        }, 0);

        let regexString = '^';
        for (const part of segments) {
            if (part.startsWith('[...') && part.endsWith(']')) {
                isCatchAll = true;
                const paramName = part.slice(4, -1);
                paramNames.push(paramName);
                regexString += '/(.+)';
            } else if (part.startsWith('[[') && part.endsWith(']]')) {
                const paramName = part.slice(2, -2);
                paramNames.push(paramName);
                regexString += '(?:/([^/]+))?';
            } else if (part.startsWith('[') && part.endsWith(']')) {
                const paramName = part.slice(1, -1);
                paramNames.push(paramName);
                regexString += '/([^/]+)';
            } else {
                regexString += '/' + part.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            }
        }
        regexString += '/?$';

        const result = {regex: new RegExp(regexString), paramNames, isCatchAll, priority};
        PathRegexCache.set(path, result);
        return result;
    }

    // Create regex for prefix
    private createPrefixRegex(prefix: string) {
        const paramNames: string[] = [];
        let isCatchAll = false;
        let priority: number;

        const segments = prefix.split('/').filter(Boolean);
        priority = segments.reduce((acc, segment) => {
            if (segment.startsWith('[...')) return acc - 10;
            if (segment.startsWith('[[')) return acc - 5;
            if (segment.startsWith('[')) return acc - 1;
            return acc + 1;
        }, 0);

        let regexString = '^';
        for (const part of segments) {
            if (part.startsWith('[...') && part.endsWith(']')) {
                isCatchAll = true;
                const paramName = part.slice(4, -1);
                paramNames.push(paramName);
                regexString += '/(.+)';
            } else if (part.startsWith('[[') && part.endsWith(']]')) {
                const paramName = part.slice(2, -2);
                paramNames.push(paramName);
                regexString += '(?:/([^/]+))?';
            } else if (part.startsWith('[') && part.endsWith(']')) {
                const paramName = part.slice(1, -1);
                paramNames.push(paramName);
                regexString += '/([^/]+)';
            } else {
                regexString += '/' + part.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            }
        }
        regexString += '(?=/|$)';

        return {regex: new RegExp(regexString), paramNames, isCatchAll, priority};
    }

    private normalizePrefix(prefix: string): string {
        return prefix.startsWith('/') ? prefix.replace(/\/$/, '') : `/${prefix.replace(/\/$/, '')}`;
    }

    private extractPrefixParams(nested: NestedRouter, matchedPath: string): Record<string, string> {
        const match = matchedPath.match(nested.regex);
        if (!match) return {};

        const params: Record<string, string> = {};
        if (nested.isCatchAll && nested.paramNames.length === 1) {
            params[nested.paramNames[0]] = match[1]?.replace(/^\//, '') || '';
        } else {
            nested.paramNames.forEach((name, i) => {
                params[name] = match[i + 1] || '';
            });
        }
        return params;
    }

    // FIXED: Nested router handling without duplicate middleware application
    private async handleNestedRouters(event: RequestEvent, path: string): Promise<Response | null> {
        const sorted = [...this._nestedRouters].sort((a, b) => b.priority - a.priority);

        for (const nested of sorted) {
            const match = path.match(nested.regex);
            if (!match || match.index !== 0) continue;

            const matched = match[0];
            const remaining = path.slice(matched.length) || '/';
            const prefixParams = this.extractPrefixParams(nested, matched);

            const nestedEvent: RequestEvent = {
                ...event,
                params: {...event.params, ...prefixParams}
            };

            // Apply nested middlewares and handle nested router
            // Note: nested.router.handle() will apply its own global middlewares
            const handler = async () => await nested.router.handleAtPath(nestedEvent, remaining);
            const response = await this.applyMiddlewaresWithList(nestedEvent, nested.middlewares, handler);
            if (response) return response;
        }

        return null;
    }

    // FIXED: Local route handling without duplicate middleware application
    private async handleLocalRoutes(event: RequestEvent, method: RequestMethod, path: string) {
        const allowed = new Set<RequestMethod>();
        let getRouteForHead = false;

        for (const route of this._routes) {
            if (!route.regex.test(path)) continue;
            allowed.add(route.method);
            if (route.method === 'GET') {
                getRouteForHead = true;
                allowed.add('HEAD');
            }

            const matchesMethod = route.method === method || (method === 'HEAD' && route.method === 'GET');
            if (!matchesMethod) continue;

            const match = path.match(route.regex);
            if (!match) continue;

            const params = Object.fromEntries(
                route.paramNames.map((name, i) => [name, match[i + 1] || ''])
            );

            event.params = {...event.params, ...params};
            event.route = {...event.route, id: route.path};

            // Only apply route-specific middlewares here
            // Global middlewares were already applied in handle()
            const finalHandler = () => route.handler(event);
            return await this.applyMiddlewaresWithList(event, route.middlewares, finalHandler);
        }

        if (allowed.size > 0 || (method === 'HEAD' && getRouteForHead)) {
            const allowHeader = [...allowed].join(', ');
            if (method === 'OPTIONS') {
                return new Response(null, {
                    status: 200,
                    headers: {'Allow': allowHeader}
                });
            }
            return new Response('Method Not Allowed', {
                status: 405,
                headers: {'Allow': allowHeader}
            });
        }

        return new Response('Not Found', {status: 404});
    }

    private sortRoutes(): void {
        this._routes.sort((a, b) => b.priority - a.priority);
        this.routesSorted = true;
    }

    private sortWsRoutes(): void {
        this._wsRoutes.sort((a, b) => b.priority - a.priority);
        this.wsRoutesSorted = true;
    }

    private formatActionResult(result: any): Response {
        if (result instanceof Response) return result;
        if (result?.type === 'failure' && 'status' in result) {
            return Action.fail(result.status, result.data);
        }
        return Action.success(200, result ?? undefined);
    }

    private handleActionError(err: unknown): Response {
        if (isHttpError(err)) {
            return Action.error(err.status, {message: err.statusText || 'Error'});
        }
        if (isRedirect(err)) {
            const url = err.headers.get('Location') || '/';
            return Action.redirect(err.status, url);
        }
        console.error(err);
        return Action.error(500, {message: 'Internal Server Error'});
    }

    static New(): Router {
        return new Router();
    }
}

// Action utilities
export const Action = {
    success: (code: number = 200, data?: Record<string, any>): Response =>
        new Response(JSON.stringify({data, type: 'success', status: code}), {
            status: code,
            headers: {'Content-Type': 'application/json'}
        }),

    redirect: (code: number = 302, location: string): Response =>
        new Response(JSON.stringify({location, type: 'redirect', status: code}), {
            status: code,
            headers: {'Content-Type': 'application/json'}
        }),

    error: (code: number = 500, error: App.Error): Response =>
        new Response(JSON.stringify({error, type: 'error', status: code}), {
            status: code,
            headers: {'Content-Type': 'application/json'}
        }),

    fail: (code: number = 400, data: Record<string, any>): Response =>
        new Response(JSON.stringify({data, type: 'failure', status: code}), {
            status: code,
            headers: {'Content-Type': 'application/json'}
        })
} as const;
