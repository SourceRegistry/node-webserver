import {DefaultErrorHandler, EnhancedEvent, EnhanceErrorHandler} from "./index";


const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

export type AuthOptions = {
    onError?: EnhanceErrorHandler;
};

export const Auth = {
    Bearer: (input: EnhancedEvent, options: AuthOptions = {}) => {
        const onError = options.onError ?? DefaultErrorHandler;
        const header = input.request.headers.get('Authorization');
        const match = header ? BEARER_PATTERN.exec(header) : null;
        if (!match) {
            throw onError({status: 401, message: 'Invalid or missing Bearer token', request: input});
        }
        return {
            token: match[1]
        };
    }
};
