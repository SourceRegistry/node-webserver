import {Cookies} from "./Cookies";

export interface RequestEvent<
    Params extends Partial<Record<string, string>> = Partial<Record<string, string>>,
    RouteId extends string  = string,
    Locals extends App.Locals = App.Locals
> {
    /**
     * Get or set cookies related to the current request
     */
    cookies: Cookies;
    /**
     * The client's IP address, set by the adapter.
     */
    getClientAddress: () => string;
    /**
     * Contains custom data that was added to the request within the middlewares.
     */
    locals: Locals;
    /**
     * The parameters of the current route - e.g. for a route like `/blog/[slug]`, a `{ slug: string }` object.
     */
    params: Params;
    /**
     * Additional data made available through the adapter.
     */
    platform: Readonly<App.Platform> | undefined;
    /**
     * The original request object.
     */
    request: Request;
    /**
     * Info about the current route.
     */
    route: {
        /**
         * The ID of the current route - e.g. for `src/routes/blog/[slug]`, it would be `/blog/[slug]`. It is `null` when no route is matched.
         */
        id: RouteId;
    };
    /**
     * If you need to set headers for the response, you can do so using the method. This is useful if you want the page to be cached, for example:

     * Setting the same header multiple times (even in separate `load` functions) is an error — you can only set a given header once.
     *
     * You cannot add a `set-cookie` header with `setHeaders` — use the cookies API instead.
     */
    setHeaders: (headers: Record<string, string>) => void;
    /**
     * The requested URL.
     */
    url: URL;
}
