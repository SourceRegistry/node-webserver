export function isHttpError(err: unknown): err is Response {
    return err instanceof Response && err.status >= 400 && err.status < 600;
}

export function isRedirect(err: unknown): err is Response {
    return err instanceof Response && err.status >= 300 && err.status < 400;
}
