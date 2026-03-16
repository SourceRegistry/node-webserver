import {type ParseOptions, parse, serialize, type SerializeOptions} from "cookie";

export class Cookies {
    private readonly setCookieHeader: (serialized: string) => void;
    private readonly raw: string;

    constructor(request: Request, setCookieHeader: (serialized: string) => void) {
        this.raw = request.headers.get('cookie') ?? '';
        this.setCookieHeader = setCookieHeader;
    }

    get(name: string, opts?: ParseOptions): string | undefined {
        return parse(this.raw, opts)[name];
    }

    getAll(opts?: ParseOptions): { name: string; value: string }[] {
        return Object.entries(parse(this.raw, opts))
            .filter(([, v]) => v !== undefined)
            .map(([name, value]) => ({name, value})) as {name: string, value: string}[];
    }

    set(name: string, value: string, opts: SerializeOptions & { path: string }): void {
        this.setCookieHeader(serialize(name, value, opts));
    }

    delete(name: string, opts: SerializeOptions & { path: string }): void {
        this.set(name, '', {...opts, maxAge: 0});
    }
}
