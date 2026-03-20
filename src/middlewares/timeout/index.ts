import type {Middleware} from "../../types";

export interface Options {
    /**
     * Deadline in milliseconds
     */
    ms: number;

    /**
     * Status code to return on timeout
     * @default 504
     */
    status?: number;

    /**
     * Response body to return on timeout
     * @default "Gateway Timeout"
     */
    body?: BodyInit | null;

    /**
     * Optional callback invoked when the deadline is exceeded
     */
    onTimeout?: () => void;
}

export function deadline(options: Options): Middleware {
    const {
        ms,
        status = 504,
        body = "Gateway Timeout",
        onTimeout
    } = options;

    if (!Number.isFinite(ms) || ms <= 0) {
        throw new TypeError("Timeout.deadline requires a positive ms value");
    }

    return async (event, next) => {
        const originalRequest = event.request;
        const timeoutController = new AbortController();
        const onAbort = () => timeoutController.abort();
        originalRequest.signal.addEventListener("abort", onAbort, {once: true});

        const signal = AbortSignal.any([originalRequest.signal, timeoutController.signal]);
        event.request = new Request(originalRequest, {
            signal,
            // @ts-ignore
            duplex: originalRequest.body ? "half" : undefined
        });

        let timer: ReturnType<typeof setTimeout> | undefined;

        try {
            return await Promise.race([
                next(),
                new Promise<Response>((resolve) => {
                    timer = setTimeout(() => {
                        timeoutController.abort();
                        onTimeout?.();
                        resolve(new Response(body, {status}));
                    }, ms);
                })
            ]);
        } finally {
            originalRequest.signal.removeEventListener("abort", onAbort);
            if (timer) {
                clearTimeout(timer);
            }
        }
    };
}
