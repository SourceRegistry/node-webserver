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

function createSSEChunk(data?: unknown, options: SSEEmitOptions = {}): string {
    const lines: string[] = [];

    if (options.comment) {
        for (const line of options.comment.split(/\r?\n/)) {
            lines.push(`: ${line}`);
        }
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

export default <Path extends string>(emitter: SSEHandler<Path>, init: ResponseInit = {}): RouteHandler<Path> => {
    return (event) => {
        const encoder = new TextEncoder();
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
        let closed = false;
        let cleanup: void | (() => MaybePromise<void>);

        const closeStream = async () => {
            if (closed) return;
            closed = true;

            try {
                await cleanup?.();
            } finally {
                controllerRef?.close();
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

                try {
                    cleanup = await emitter(event, emit);
                    if (!event.request.signal.aborted && cleanup === undefined) {
                        return;
                    }
                    if (event.request.signal.aborted) {
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
