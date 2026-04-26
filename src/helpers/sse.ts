import {MaybePromise} from "../types/MaybePromise";
import {RouteHandler} from "../types";

export type SSEEmitOptions = {
    event?: string;
    id?: string;
    retry?: number;
    comment?: string;
};

export type SSEEmit = (data?: unknown, options?: SSEEmitOptions) => void;

export type SSEHandler<Path extends string> = (
    event: Parameters<RouteHandler<Path>>[0],
    emit: SSEEmit
) => MaybePromise<void | (() => MaybePromise<void>)>;

export type SSEOptions = ResponseInit & {
    /**
     * Interval in milliseconds for sending SSE keep-alive comments.
     * @default 15_000
     * @see Set to `0` to disable keep-alive entirely.
     */
    keepaliveInterval?: number;
};

function createSSEChunk(data?: unknown, options: SSEEmitOptions = {}): string {
    const lines: string[] = [];

    if (options.comment) {
        const sanitized = options.comment.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');
        lines.push(`: ${sanitized}`);
    }
    if (options.event) lines.push(`event: ${options.event}`);
    if (options.id) lines.push(`id: ${options.id}`);
    if (options.retry !== undefined) lines.push(`retry: ${options.retry}`);

    if (data !== undefined) {
        const content = typeof data === "string" ? data : JSON.stringify(data);
        for (const line of content.split(/\r?\n/)) {
            lines.push(`data: ${line}`);
        }
    }

    return `${lines.join('\n')}\n\n`;
}

const DEFAULT_KEEPALIVE_INTERVAL = 15_000;

export default <Path extends string>(emitter: SSEHandler<Path>, options: SSEOptions = {}): RouteHandler<Path> => {
    const {keepaliveInterval = DEFAULT_KEEPALIVE_INTERVAL, ...init} = options;

    return (event) => {
        const encoder = new TextEncoder();
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
        let closed = false;
        let cleanup: void | (() => MaybePromise<void>);
        let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

        const closeStream = async () => {
            if (closed) return;
            closed = true;

            if (keepaliveTimer !== null) {
                clearInterval(keepaliveTimer);
                keepaliveTimer = null;
            }

            try {
                await cleanup?.();
            } finally {
                try {
                    controllerRef?.close();
                } catch {
                }
            }
        };

        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                controllerRef = controller;

                const emit: SSEEmit = (data, options = {}) => {
                    if (closed) return;
                    controller.enqueue(encoder.encode(createSSEChunk(data, options)));
                };

                event.request.signal.addEventListener("abort", () => {
                    void closeStream();
                }, {once: true});

                if (keepaliveInterval > 0) {
                    keepaliveTimer = setInterval(() => {
                        if (closed) return;
                        controller.enqueue(encoder.encode(": keep-alive\n\n"));
                    }, keepaliveInterval);
                    keepaliveTimer?.unref();
                }

                try {
                    cleanup = await emitter(event, emit);
                    if (event.request.signal.aborted) {
                        await closeStream();
                        return;
                    }

                    if (cleanup === undefined) {
                        await closeStream();
                    }
                } catch (err) {
                    if (!closed) controller.error(err);
                }
            },
            async cancel() {
                await closeStream();
            }
        });

        return new Response(stream, {
            ...init,
            headers: {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                'connection': 'keep-alive',
                ...init.headers
            }
        });
    }
}
