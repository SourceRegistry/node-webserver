import {DefaultErrorHandler, EnhancedEvent, EnhanceErrorHandler} from "./index";
import {MaybePromise} from "../types/MaybePromise";


//region Validator
/**
 * A single validation issue produced by a validator.
 */
export type ValidationIssue = {
    path: string;
    message: string;
    code?: string;
};
/**
 * Successful validation result.
 */
export type ValidationSuccess<T> = {
    success: true;
    data: T;
};
/**
 * Failed validation result.
 */
export type ValidationFailure = {
    success: false;
    errors: ValidationIssue[];
};

/**
 * The result returned by all validators.
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;
/**
 * Internal path representation used while walking nested values.
 */
export type ValidationPath = Array<string | number>;

export type Validator<T> = (value: unknown, path?: ValidationPath) => ValidationResult<T>;

type AnyValidator = Validator<any>;

//endregion

export type InferValidator<V> = V extends Validator<infer T> ? T : never;


type SchemaOptions = {
    prefix_name?: string;
    unpack_prefixed?: boolean;
    transform?: (value: FormDataEntryValue, key: string, data: FormData) => any;
    processor?: (input: any) => any;
    onError?: EnhanceErrorHandler;
};

export type FormEnhanceOptions = {
    onError?: EnhanceErrorHandler;
};

/**
 * Side-effect observer used by `Form.handle()`. Unlike `EnhanceErrorHandler`
 * (which builds the Response that gets thrown), these just react to
 * whatever was already thrown — e.g. for logging.
 */
type FormErrorObserver = (error: unknown) => void | Promise<void>;

const reviveMap = new Map<string | RegExp, (v: string) => any>([
    ['true', () => true],
    ['false', () => false],
    ['null', () => null],
    ['undefined', () => undefined],
    ['Infinity', () => Infinity],
    ['-Infinity', () => -Infinity],
    ['NaN', () => NaN],
    [/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/, (v) => Number(v)],
    [/^\s*\{[\s\S]*}\s*$/, (v) => JSON.parse(v, reviver)],
    [/^\s*\[[\s\S]*]\s*$/, (v) => JSON.parse(v, reviver)]
]);

export const reviver = (key: string | undefined, value: any) => {
    if (typeof value !== 'string') return value;

    for (const [pattern, converter] of reviveMap) {
        if (
            (typeof pattern === 'string' && pattern === value) ||
            (pattern instanceof RegExp && pattern.test(value))
        ) {
            try {
                return converter(value);
            } catch {
                return value;
            }
        }
    }

    return value;
};

const createContext = (data: FormData, onError: EnhanceErrorHandler = DefaultErrorHandler) => {
    return {
        get data() {
            return data;
        },
        has: (...names: string[]) => {
            if (names.length === 0) return false;
            if (names.length === 1) return data.has(names[0])
            else return hasOneOf(data, names);
        },
        hasOneOf: (...name: string[]) => hasOneOf(data, name),
        string: (name: string) => string(data, name, onError) ?? undefined,
        _string: (name: string) => string(data, name, onError),
        string$: (name: string) => string$(data, name, onError),
        pattern$: (name: string, pattern: string | RegExp) => pattern$(data, name, pattern, onError),
        enum: <E extends Record<string, string | number | any>>(
            name: string,
            _enum: E
        ): keyof E | undefined => Enum(data, name, _enum, onError),
        enum$: <E extends Record<string, string | number | any>>(name: string, _enum: E) =>
            Enum$<E>(data, name, _enum, onError),
        date: (
            name: string,
            parser: (formdata: FormData, name: string) => number | string | Date | undefined = (
                data,
                name
            ) => data.get(name) as string
        ) => date(data, name, parser) ?? undefined,
        _date: (
            name: string,
            parser: (formdata: FormData, name: string) => number | string | Date | undefined = (
                data,
                name
            ) => data.get(name) as string
        ) => date(data, name, parser),
        date$: (
            name: string,
            parser: (formdata: FormData, name: string) => number | string | Date = (data, name) =>
                data.get(name) as string
        ) => date$(data, name, parser),
        process: <T, R>(
            name: string,
            parser: ((formdata: FormData, name: string) => T) | ((name: string) => T),
            processor: (val: T, name: string) => R
        ) =>
            process<T, R>(
                data,
                name,
                (formdata, name) =>
                    parser.length === 2
                        ? (parser as (data: FormData, name: string) => T)(formdata, name)
                        : (parser as (name: string) => T)(name),
                processor
            ),
        number: (name: string) => number(data, name, onError) ?? undefined,
        number$: (name: string) => number$(data, name, onError),
        _number: (name: string) => number(data, name, onError),
        boolean: (name: string) => boolean(data, name) ?? undefined,
        boolean$: (name: string) => boolean$(data, name, onError),
        _boolean: (name: string) => boolean(data, name),
        json: <T = unknown, F = T>(
            name: string,
            transformer: (val: F) => T = (val) => <T>(<unknown>val)
        ) => json<T, F>(data, name, transformer, onError),
        jsond: (
            options: {
                transform?: (value: FormDataEntryValue, key: string, data: FormData) => any;
                processor?: (input: any) => any;
            } & ({ prefix_name: string; unpack_prefixed?: true } | { prefix_name?: undefined })
        ) => jsond(data, options),
        json$: <T = unknown, F = T>(
            name: string,
            transformer: (val: F) => T = (val) => <T>(<unknown>val)
        ) => json$<T, F>(data, name, transformer, onError),
        file: (name: string) => file(data, name, onError),
        file$: (name: string) => file$(data, name, onError),
        files: (name: string) => files(data, name),
        fileRecord: (prefix: string, removePrefix: boolean = false) =>
            fileRecord(data, prefix, removePrefix),
        array: <T>(
            name: string,
            mapper?: (item: FormDataEntryValue, index: number, array: FormDataEntryValue[]) => T
        ) => array<T>(data, name, mapper),
        array$: <T>(
            name: string,
            mapper?: (item: FormDataEntryValue, index: number, array: FormDataEntryValue[]) => T
        ) => array$<T>(data, name, mapper, onError),
        onlyIf: <T = never>(condition: boolean, TRUE: T, FALSE = undefined) =>
            onlyIf<T>(condition, TRUE, FALSE),
        onlyIfPresent: <T = never>(
            key: string,
            TRUE: (entry: FormDataEntryValue) => T,
            FALSE = undefined
        ) => onlyIfPresent(data, key, TRUE, FALSE),
        onlyIfArrayPresent: <T, R>(key: string, TRUE: (entries: FormDataEntryValue[]) => T, FALSE: R) =>
            onlyIfArrayPresent<T, R>(data, key, TRUE, FALSE),
        selector: <
            C extends (A extends true
                ? { [K in string]: (entries: FormDataEntryValue[], key: K) => T }
                : { [K in string]: (entry: FormDataEntryValue, key: K) => T }) & {
                $error?: (error: unknown) => never;
                $default?: (data: FormData) => T;
            },
            A extends boolean = false,
            T = any
        >(
            cases: C,
            useArray: A = false as A
        ): ReturnType<C[keyof C]> | undefined => selector<C, A, T>(data, cases, useArray),
        selector$: <
            C extends (A extends true
                ? { [K in string]: (entries: FormDataEntryValue[], key: K) => T }
                : { [K in string]: (entry: FormDataEntryValue, key: K) => T }) & {
                $error?: (error: unknown) => never;
                $default?: (data: FormData) => T;
            },
            A extends boolean = false,
            T = any
        >(
            cases: C,
            useArray: A = false as A
        ): ReturnType<C[keyof C]> => selector$<C, A, T>(data, cases, useArray, onError),
        basedOn: <T = unknown, R = unknown>(
            val: T,
            processor: (val: T) => R = (val) => <R>(<unknown>val)
        ) => basedOn<T, R>(val, processor),
        record: <T = any>(
            options?: Partial<{
                transformer: (
                    value: [string, FormDataEntryValue | FormDataEntryValue[]]
                ) => [string, any | any[]];
                filter: (value: [string, FormDataEntryValue[]]) => boolean;
            }>
        ) => record(data, options) as T,
        validate: <T extends Validator<any>>(
            schema: T,
            options: SchemaOptions = {
                unpack_prefixed: true,
                transform: (value) => value
            }
        ) => validate(data, schema, {onError, ...options})
    };
};

export type FormContext = ReturnType<typeof createContext>;

export function hasOneOf(formdata: FormData, names: string[]) {
    return names.some((name) => formdata.has(name));
}

export function string(formdata: FormData, name: string, onError: EnhanceErrorHandler = DefaultErrorHandler) {
    if (!formdata.has(name)) {
        return undefined;
    }
    const data = formdata.get(name);
    if (data === 'null' || data === null) return null;
    if (typeof data != 'string') {
        throw onError({status: 400, message: `${name} isn't of type string`, data: {targets: [name]}});
    }
    return data as string;
}

export function string$(formdata: FormData, name: string, onError: EnhanceErrorHandler = DefaultErrorHandler) {
    if (!formdata.has(name)) {
        throw onError({status: 400, message: `${name} is required`, data: {targets: [name]}});
    }
    const data = formdata.get(name);
    if (typeof data != 'string') {
        throw onError({status: 400, message: `${name} is not correct data type`, data: {targets: [name]}});
    }
    return data as string;
}

/**
 * Reads a required string and validates it against a regex pattern.
 * Accepts either a prebuilt `RegExp` or a pattern string.
 */
export function pattern$(formdata: FormData, name: string, pattern: string | RegExp, onError: EnhanceErrorHandler = DefaultErrorHandler) {
    if (!formdata.has(name)) throw onError({status: 400, message: `${name} is required`, data: {targets: [name]}});
    const data = formdata.get(name);
    if (!data || typeof data != 'string')
        throw onError({status: 400, message: `${name} is not correct data type`, data: {targets: [name]}});
    if (typeof pattern === 'string') pattern = new RegExp(pattern);
    if (!pattern.test(data.toString()))
        throw onError({status: 400, message: `${name} is not in correct format`, data: {targets: [name]}});
    return data as string;
}

export function number(formdata: FormData, name: string, onError: EnhanceErrorHandler = DefaultErrorHandler) {
    if (!formdata.has(name)) {
        return undefined;
    }
    const val = formdata.get(name)
    if (val === '') return undefined;
    if (val === null) return null;
    const num = Number(val);
    if (isNaN(num)) {
        throw onError({status: 400, message: `${name} isn't of type number`, data: {targets: [name]}});
    }
    return num;
}

export function number$(formdata: FormData, name: string, onError: EnhanceErrorHandler = DefaultErrorHandler) {
    const _number = number(formdata, name, onError);
    if (_number === undefined || _number === null) {
        throw onError({status: 400, message: `${name} is required`, data: {targets: [name]}});
    }
    return _number;
}

export function boolean(formdata: FormData, name: string) {
    if (!formdata.has(name)) return undefined;
    const data = formdata.get(name) as string;
    if (data === '') return false;
    if (data === null) return null;
    const num = Number(data);
    if (!isNaN(num)) {
        return num > 0;
    } else {
        return data.trim().toLowerCase().startsWith('t') || data.trim().toLowerCase() === 'on';
    }
}

export function boolean$(formdata: FormData, name: string, onError: EnhanceErrorHandler = DefaultErrorHandler) {
    if (!formdata.has(name)) {
        throw onError({status: 400, message: `${name} is required`, data: {targets: [name]}});
    }
    const data = formdata.get(name) as string;
    const num = Number(data);
    if (!isNaN(num)) {
        return num > 0;
    } else {
        return data.trim().toLowerCase().startsWith('t') || data.trim().toLowerCase() === 'on';
    }
}

export function date(
    formdata: FormData,
    name: string,
    parser: (formdata: FormData, name: string) => number | string | Date | undefined = (data, name) =>
        data.get(name) as string
) {
    if (!formdata.has(name)) {
        return undefined;
    }
    const val = parser(formdata, name);
    if (!val) {
        return null;
    }
    return new Date(val);
}

export function date$(
    formdata: FormData,
    name: string,
    parser: (formdata: FormData, name: string) => number | string | Date
) {
    return new Date(parser(formdata, name));
}

export function json<T = unknown, F = T>(
    formdata: FormData,
    name: string,
    transformer: (val: F) => T = (val) => <T>(<unknown>val),
    onError: EnhanceErrorHandler = DefaultErrorHandler
) {
    if (!formdata.has(name)) {
        return undefined;
    }
    try {
        return transformer(JSON.parse(formdata.get(name) as string, reviver));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
        throw onError({status: 400, message: `${name} isn't of json`, data: {targets: [name]}});
    }
}

export function record(
    formdata: FormData,
    options?: Partial<{
        transformer: (
            value: [string, FormDataEntryValue | FormDataEntryValue[]]
        ) => [string, any | any[]];
        filter: (value: [string, FormDataEntryValue[]]) => boolean;
    }>
) {
    return Object.fromEntries(
        Array.from(formdata.keys())
            .map((key) => {
                let entry: [string, FormDataEntryValue[]] = [key, formdata.getAll(key)];
                if (options && options.filter && !options.filter(entry)) return;
                return entry;
            })
            .filter((v) => v !== undefined)
            .map(([key, value]) => [key, Array.isArray(value) && value.length === 1 ? value[0] : value] satisfies [string, FormDataEntryValue | FormDataEntryValue[]])
            .map((entry) => {
                if (options && options.transformer) entry = options.transformer(entry);
                return entry;
            })
    );
}

export function json$<T = unknown, F = T>(
    formdata: FormData,
    name: string,
    transformer: (val: F) => T = (val) => <T>(<unknown>val),
    onError: EnhanceErrorHandler = DefaultErrorHandler
) {
    if (!formdata.has(name)) {
        throw onError({status: 400, message: `${name} doesn't exist`, data: {targets: [name]}});
    }
    try {
        return transformer(JSON.parse(formdata.get(name) as string, reviver));
    } catch (e) {
        throw onError({
            status: 400,
            message: `${name} isn't of type json`,
            data: {
                targets: [name],
                error: e instanceof Error ? e?.message : e?.toString()
            }
        });
    }
}

export function jsond(
    formdata: FormData,
    options: {
        prefix_name?: string;
        unpack_prefixed?: boolean;
        transform?: (value: FormDataEntryValue, key: string, data: FormData) => any;
        processor?: (input: any) => any;
    } = {
        unpack_prefixed: true,
        transform: (value) => value
    }
) {
    let result: any = {};
    Array.from(formdata.entries())
        .filter(([key]) => (options.prefix_name ? key.startsWith(options.prefix_name) : key))
        .map(
            ([key, value]) =>
                [key, (options.transform ?? ((value) => value))(value, key, formdata)] as [string, any]
        )
        .map(
            ([key, value]) =>
                (options.unpack_prefixed && options.prefix_name
                    ? [key.replace(options.prefix_name, ''), value]
                    : [key, value]) as [string, any]
        )
        .forEach(([key, value]) => {
            const splits = key.split('.');
            let context = result;
            splits.forEach((part, index) => {
                if (index === splits.length - 1) {
                    // If it's the last part, check if the key already exists
                    if (context[part] === undefined) {
                        context[part] = value;
                    } else if (Array.isArray(context[part])) {
                        context[part].push(value);
                    } else {
                        context[part] = [context[part], value];
                    }
                } else {
                    // If the key doesn't exist, initialize it as an object
                    if (!context[part]) context[part] = {};
                    // Move deeper into the object
                    context = context[part];
                }
            });
        });
    if (options.processor) {
        result = options.processor(result);
    }
    return result;
}

export function file(formdata: FormData, name: string, onError: EnhanceErrorHandler = DefaultErrorHandler) {
    if (!formdata.has(name)) {
        return undefined;
    }
    const data = formdata.get(name);
    if (data instanceof File) {
        return formdata.get(name) as File;
    } else if (data === null || data === 'null') {
        return null;
    }
    throw onError({status: 400, message: `${name} isn't of type File`, data: {targets: [name]}});
}

export function fileRecord(formdata: FormData, prefix: string, removePrefix: boolean = false) {
    const record: Record<string, File[]> = {};
    Array.from(formdata.entries())
        .filter(
            ([key, value]) =>
                key.startsWith(prefix) && value instanceof File && value.size > 0 && value.name.length > 0
        )
        .map(
            ([key, value]) =>
                [removePrefix ? key.replace(prefix, '') : key, value as File] as [string, File]
        )
        .forEach(([key, value]) => {
            if (!(key in record) || !record[key]) return (record[key] = [value]);
            else record[key].push(value);
        });
    return record;
}

export function file$(formdata: FormData, name: string, onError: EnhanceErrorHandler = DefaultErrorHandler) {
    if (!formdata.has(name)) {
        throw onError({status: 400, message: `${name} doesn't exist`, data: {targets: [name]}});
    }
    const data = formdata.get(name);
    if (data instanceof File) {
        return formdata.get(name) as File;
    }
    throw onError({status: 400, message: `${name} isn't of type File`, data: {targets: [name]}});
}

export function files(formdata: FormData, name: string) {
    if (!formdata.has(name)) {
        return <File[]>[];
    }
    return <File[]>(
        formdata.getAll(name).filter((e) => e instanceof File && e.size > 0 && e.name.length > 0)
    );
}

export function array<T>(
    formdata: FormData,
    name: string,
    mapper?: (item: FormDataEntryValue, index: number, array: FormDataEntryValue[]) => T
) {
    if (!formdata.has(name)) {
        return undefined;
    }
    const array = formdata.getAll(name);
    if (array.length === 1 && array[0] === '[]') {
        return <T[]>[];
    }
    if (!mapper) {
        return <T[]>array;
    }
    return <T[]>array.map(mapper);
}

export function array$<T>(
    formdata: FormData,
    name: string,
    mapper?: (item: FormDataEntryValue, index: number, array: FormDataEntryValue[]) => T,
    onError: EnhanceErrorHandler = DefaultErrorHandler
) {
    if (!formdata.has(name)) {
        throw onError({status: 400, message: `${name} doesn't exist`, data: {targets: [name]}});
    }
    const array = formdata.getAll(name);
    if (!mapper) {
        return <T[]>array;
    }
    const res = <T[]>array.map(mapper);
    if (res.length === 0) {
        throw onError({status: 400, message: `${name} length of array === 0`, data: {targets: [name]}});
    }
    return res;
}

/**
 * TODO not compliant with enum standard but works for now
 * @param formdata
 * @param name
 * @param _enum
 * @param onError
 */
export function Enum<E extends Record<string, string | number | any>>(
    formdata: FormData,
    name: string,
    _enum: E,
    onError: EnhanceErrorHandler = DefaultErrorHandler
): keyof E | undefined {
    if (!formdata.has(name)) {
        return undefined;
    }
    const data = formdata.get(name);
    if (typeof data != 'string') {
        throw onError({status: 400, message: `${name} isn't of type in enum`, data: {targets: [name]}});
    }
    if (!(data in _enum)) return undefined;
    return data as keyof E;
}

/**
 * TODO not compliant with enum standard but works for now
 * @param formdata
 * @param name
 * @param _enum
 * @param onError
 */
export function Enum$<E extends Record<string, string | number | any>>(
    formdata: FormData,
    name: string,
    _enum: E,
    onError: EnhanceErrorHandler = DefaultErrorHandler
): E[keyof E] {
    const data = Enum(formdata, name, _enum, onError);
    if (!data)
        throw onError({status: 400, message: `${name} isn't of type in enum`, data: {targets: [name]}});
    return _enum[data];
}

export function OldArray<T = string>(
    formdata: FormData,
    name: string,
    parser: (input: { data: string }) => T[]
) {
    const data = string(formdata, name);
    if (!data) {
        return [];
    }
    return parser({data});
}

export function arrayString<T = string>(
    formdata: FormData,
    name: string,
    delimiter: string,
    mapper?: (item: string) => T
) {
    return OldArray(formdata, name, ({data}) => data.split(delimiter).map(mapper ?? ((i) => <T>i)));
}

export function onlyIf<T = never>(condition: boolean, TRUE: T, FALSE = undefined) {
    return condition ? TRUE : FALSE;
}

export function onlyIfPresent<T = never>(
    formdata: FormData,
    key: string,
    TRUE: (entry: FormDataEntryValue) => T,
    FALSE = undefined
) {
    return formdata.has(key) ? TRUE(<FormDataEntryValue>formdata.get(key)) : FALSE;
}

export function onlyIfArrayPresent<T, R>(
    formdata: FormData,
    key: string,
    TRUE: (entries: FormDataEntryValue[]) => T,
    FALSE: R
): T | R {
    return formdata.has(key) && Array.isArray(formdata.getAll(key))
        ? TRUE(formdata.getAll(key))
        : FALSE;
}

export function basedOn<T = unknown, R = unknown>(
    val: T,
    processor: (val: T) => R = (val) => <R>(<unknown>val)
) {
    return processor(val);
}

export function selector<
    C extends (A extends true
        ? { [K in string]: (entries: FormDataEntryValue[], key: K) => T }
        : { [K in string]: (entry: FormDataEntryValue, key: K) => T }) & {
        $error?: (error: unknown) => never;
        $default?: (data: FormData) => T;
    },
    A extends boolean = false,
    T = any
>(formData: FormData, cases: C, useArray: A = false as A): ReturnType<C[keyof C]> | undefined {
    try {
        for (const key of formData.keys()) {
            if (key in cases) {
                const processor = cases[key as keyof typeof cases];
                if (formData.has(key)) {
                    if (useArray) {
                        const data = formData.getAll(key);
                        if (data.length > 0) {
                            return (
                                processor as (
                                    entries: FormDataEntryValue[],
                                    key: string
                                ) => ReturnType<C[keyof C]> | undefined
                            )(data, key);
                        }
                    } else {
                        const data = formData.get(key);
                        if (data !== null) {
                            return (
                                processor as (
                                    entry: FormDataEntryValue,
                                    key: string
                                ) => ReturnType<C[keyof C]> | undefined
                            )(data, key);
                        }
                    }
                }
            }
        }
        if ('$default' in cases) {
            return (cases.$default as any)(formData);
        }
    } catch (error) {
        // Call $error in case of any error
        if ('$error' in cases) {
            return cases.$error?.(error);
        }
    }
    return undefined;
}

export function selector$<
    C extends (A extends true
        ? { [K in string]: (entries: FormDataEntryValue[], key: K) => T }
        : { [K in string]: (entry: FormDataEntryValue, key: K) => T }) & {
        $error?: (error: unknown) => never;
        $default?: (data: FormData) => T;
    },
    A extends boolean = false,
    T = any
>(formData: FormData, cases: C, useArray: A = false as A, onError: EnhanceErrorHandler = DefaultErrorHandler): NonNullable<ReturnType<C[keyof C]>> {
    const result = selector(formData, cases, useArray);
    if (!result) {
        if ('$error' in cases) {
            cases?.['$error']?.('Unable to find value');
        }
        throw onError({status: 400, message: `Unable to find value`, data: {targets: Object.keys(cases)}});
    }
    return result as NonNullable<ReturnType<C[keyof C]>>;
}

export async function handle<T>(
    data: MaybePromise<FormData> | Request,
    fn: (input: { data: FormData; form: FormContext }) => MaybePromise<T>,
    ...errorHandlers: FormErrorObserver[]
): Promise<T> {
    try {
        if (
            data instanceof Request &&
            data.headers.has('Content-Type') &&
            data.headers.get('Content-Type')?.includes('form')
        ) {
            data = await data.formData();
        } else {
            throw DefaultErrorHandler({status: 400, message: "Request doesn't contain form data"});
        }
        return await fn({data: data as FormData, form: createContext(data)});
    } catch (e) {
        for (const errorHandler of errorHandlers) {
            try {
                await errorHandler(e);
            } catch (e) {
                throw e;
            }
        }
        throw e;
    }
}

/**
 * Builds a `FormContext` from the request body. Returns an `EventEnhancer`,
 * so compose it with `enhance()` like any other enhancer:
 *
 * ```ts
 * enhance(handler, Form.enhance())
 * enhance(handler, Form.enhance({ onError: ({status, message}) => new Response(message, {status}) }))
 * ```
 */
export function enhance(options: FormEnhanceOptions = {onError: DefaultErrorHandler}) {
    return async (input: EnhancedEvent): Promise<{ form: FormContext }> => {
        const data =
            input.request.headers.has('Content-Type') &&
            input.request.headers.get('Content-Type')?.includes('form')
                ? await input.request.formData()
                : new FormData();

        return {
            form: createContext(data, options.onError)
        };
    };
}

export function process<T, R>(
    formdata: FormData,
    name: string,
    parser: (formdata: FormData, name: string) => T,
    processor: (val: T, name: string) => R
) {
    return processor(parser(formdata, name), name);
}

export function validate<const T extends AnyValidator>(
    formdata: FormData,
    validator: T,
    options: SchemaOptions = {
        unpack_prefixed: true,
        transform: (value) => {
            if (value instanceof File) return value;
            else return reviver(undefined, value);
        }
    }
): InferValidator<T> {
    const onError = options.onError ?? DefaultErrorHandler;
    let value = jsond(formdata, {
        unpack_prefixed: true,
        ...options,
        transform: (v) => reviver(undefined, v),
    });
    const result = validator(value)
    if (!result.success) throw onError({status: 400, message: 'Validation failed', data: {errors: result.errors}});
    return result.data as InferValidator<T>;
}

export const schema =
    <const T extends AnyValidator>(
        validator: T,
        options: SchemaOptions = {
            unpack_prefixed: true,
            transform: (value) => value
        }
    ) =>
        async (input: EnhancedEvent) => {
            const {form} = await enhance({onError: options.onError})(input);
            return {
                form: {
                    ...form,
                    result: form.validate<T>(validator, options)
                }
            } as const;
        };

export const Form = {
    string,
    string$,
    number,
    number$,
    boolean,
    boolean$,
    date,
    date$,
    file,
    file$,
    files,
    array,
    array$,
    json,
    json$,
    jsond,
    process,
    validate,
    onlyIf,
    onlyIfPresent,
    onlyIfArrayPresent,
    selector,
    selector$,
    enhance,
    schema,
    handle
};
