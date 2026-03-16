export interface RateLimitStore {
    incr(key: string): Promise<{ current: number; reset: number }>;
    resetKey?(key: string): Promise<void>;
    resetAll?(): Promise<void>;
}
