import type {MaybePromise} from "./types/MaybePromise";

export * from './app'
export * from './utils'
export * from './middlewares'
export * from './types'
export * from './helpers/static'

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

export function redirect(status: 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308 | ({} & number), location: string | URL): never {
    throw new Response(null, {
        status,
        headers: {
            location: location.toString()
        }
    })
}

export function error(status: number, body: App.Error | string): never {
    throw new Response(JSON.stringify(typeof body === "string" ? {message: body} : body), {
        status,
        headers: {
            'content-type': 'application/json'
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

export {default as dir} from "./helpers/static"

export {default as sse} from "./helpers/sse"
