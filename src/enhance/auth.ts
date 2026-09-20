import {DefaultErrorHandler, EnhancedEvent, EnhanceErrorHandler} from "./index";
import {MaybePromise} from "../types/MaybePromise";


const BEARER_PATTERN = /^Bearer\s+(.+)$/i;
const BASIC_PATTERN = /^Basic\s+(.+)$/i;

export type AuthOptions = {
    onError?: EnhanceErrorHandler;
};

export type BasicCredentials = {
    username: string;
    password: string;
    request: Request;
};

export type BasicAuthOptions = AuthOptions & {
    /** Sent back in `WWW-Authenticate: Basic realm="..."` on a 401. Defaults to "Restricted". */
    realm?: string;
};

const defaultBasicErrorHandler = (realm: string): EnhanceErrorHandler => (ctx) => {
    const content = JSON.stringify({message: ctx.message, ...ctx.data});
    throw new Response(content, {
        status: ctx.status,
        headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(content).toString(),
            'www-authenticate': `Basic realm="${realm}"`
        }
    });
};

export const Auth = {
    Bearer: (options: AuthOptions = {}) => (input: EnhancedEvent) => {
        const onError = options.onError ?? DefaultErrorHandler;
        const header = input.request.headers.get('Authorization');
        const match = header ? BEARER_PATTERN.exec(header) : null;
        if (!match) {
            throw onError({status: 401, message: 'Invalid or missing Bearer token', request: input});
        }
        return {
            token: match[1]
        };
    },

    /**
     * HTTP Basic auth (RFC 7617). `lookup` verifies the decoded
     * username/password and returns whatever should end up on
     * `event.context.user` — return a falsy value to reject the request.
     *
     * ```ts
     * enhance(handler, Auth.Basic(({ username, password }) => findUser(username, password)))
     * ```
     */
    Basic: <T>(
        lookup: (credentials: BasicCredentials) => MaybePromise<T>,
        options: BasicAuthOptions = {}
    ) => async (input: EnhancedEvent) => {
        const realm = options.realm ?? 'Restricted';
        const onError = options.onError ?? defaultBasicErrorHandler(realm);

        const header = input.request.headers.get('Authorization');
        const match = header ? BASIC_PATTERN.exec(header) : null;
        if (!match) {
            throw onError({status: 401, message: 'Invalid or missing Basic credentials', request: input});
        }

        let decoded: string;
        try {
            decoded = Buffer.from(match[1], 'base64').toString('utf-8');
        } catch {
            throw onError({status: 401, message: 'Invalid Basic credentials encoding', request: input});
        }

        const separatorIndex = decoded.indexOf(':');
        if (separatorIndex === -1) {
            throw onError({status: 401, message: 'Invalid Basic credentials format', request: input});
        }

        const username = decoded.slice(0, separatorIndex);
        const password = decoded.slice(separatorIndex + 1);

        const user = await lookup({username, password, request: input.request});
        if (!user) {
            throw onError({status: 401, message: 'Invalid username or password', request: input});
        }

        return {user};
    }
};
