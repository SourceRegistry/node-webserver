import type {RequestEvent} from "./types";
import type {MaybePromise} from "./types/MaybePromise";
import {isResponse} from "./utils";
import type {WebSocket} from "ws";

type AnyFn = (...args: any[]) => any;

type ConcatReturnTypes<T extends AnyFn[]> = T extends []
    ? {}
    : T extends [infer First, ...infer Rest]
        ? First extends AnyFn
            ? Awaited<ReturnType<First>> & ConcatReturnTypes<Rest extends AnyFn[] ? Rest : []>
            : {}
        : {};

export type EventEnhancer<
    Params extends Partial<Record<string, string>> = Partial<Record<string, string>>,
    RouteId extends string | null = string | null,
    Locals extends App.Locals = App.Locals,
    Context extends Record<string, any> = Record<string, any>,
    TExtra extends object = {}
> = (
    event: RequestEvent<Params, RouteId, Locals> & TExtra
) => MaybePromise<Context | void | undefined | Response>;

export type EnhancedRequestEvent<
    Params extends Partial<Record<string, string>> = Partial<Record<string, string>>,
    RouteId extends string | null = string | null,
    Locals extends App.Locals = App.Locals,
    Context extends Record<string, any> = Record<string, any>
> = RequestEvent<Params, RouteId, Locals> & {
    context: Context;
};

export type EnhancedRouteHandler<
    Params extends Partial<Record<string, string>> = Partial<Record<string, string>>,
    RouteId extends string | null = string | null,
    Locals extends App.Locals = App.Locals,
    Context extends Record<string, any> = Record<string, any>
> = (
    event: EnhancedRequestEvent<Params, RouteId, Locals, Context>
) => MaybePromise<Response>;

export type EnhancedWebSocketHandler<
    Params extends Partial<Record<string, string>> = Partial<Record<string, string>>,
    RouteId extends string | null = string | null,
    Locals extends App.Locals = App.Locals,
    Context extends Record<string, any> = Record<string, any>
> = (
    event: EnhancedRequestEvent<Params, RouteId, Locals, Context> & { websocket: WebSocket }
) => MaybePromise<any>;

export const enhance = <
    Params extends Partial<Record<string, string>> = Partial<Record<string, string>>,
    RouteId extends string | null = string | null,
    Locals extends App.Locals = App.Locals,
    TExtra extends object = {},
    TReturn = unknown,
    Enhancers extends EventEnhancer<Params, RouteId, Locals, any, TExtra>[] = EventEnhancer<Params, RouteId, Locals, any, TExtra>[],
    Context extends Awaited<ConcatReturnTypes<Enhancers>> = Awaited<ConcatReturnTypes<Enhancers>>
>(
    handler: (event: EnhancedRequestEvent<Params, RouteId, Locals, Context> & TExtra) => MaybePromise<TReturn>,
    ...enhancers: Enhancers
) => {
    return async (event: RequestEvent<Params, RouteId, Locals> & TExtra): Promise<TReturn | Response> => {
        const context = {} as Context;

        for (const enhancer of enhancers) {
            const result = await enhancer(event);
            if (isResponse(result)) {
                return result;
            }

            if (result && typeof result === "object") {
                Object.assign(context, result);
            }
        }

        return handler(Object.assign(event, {context}) as any);
    };
};
