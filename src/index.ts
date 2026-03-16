import type {MaybePromise} from "./types/MaybePromise";
import {serveStatic, StaticOptions} from "./static";
import {RouteHandler} from "./types";

export * from './app'
export * from './utils'
export * from './middlewares'
export * from './types'
export * from './static'

export const json = async (data: MaybePromise<any>, init?: ResponseInit) => {
    const content = JSON.stringify(await data);
    return new Response(content, {
        ...init,
        headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(content).toString(),
            ...init?.headers
        }
    })
}

export const text = async (body: MaybePromise<string>, init?: ResponseInit) => {
    const content = await body
    return new Response(content, {
        ...init,
        headers: {
            'content-type': 'text/plain',
            'content-length': Buffer.byteLength(content).toString(),
            ...init?.headers
        }
    })
}

export const html = async (html: MaybePromise<string>, init?: ResponseInit) => {
    const content = await html
    return new Response(content, {
        ...init,
        headers: {
            'content-type': 'text/html',
            'content-length': Buffer.byteLength(content).toString(),
            ...init?.headers
        }
    })
}

export const dir = <Path extends string>(root: string, options: StaticOptions = {}): RouteHandler<Path> =>
    (event) => serveStatic(root, event, options);
