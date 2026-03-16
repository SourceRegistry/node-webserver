export function isHttpError(err: unknown): err is Response {
    return isResponse(err) && err.status >= 400 && err.status < 600;
}

export function isRedirect(err: unknown): err is Response {
    return isResponse(err) && err.status >= 300 && err.status < 400;
}

export function isResponse(err: unknown): err is Response {
    return err instanceof Response;
}
