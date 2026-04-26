import type { RateLimitStore } from './storage';

export class SlidingWindowStore implements RateLimitStore {
    private readonly windowMs: number;
    private data = new Map<string, number[]>();
    private cleanupInterval?: NodeJS.Timeout;

    constructor(opts: { windowMs: number }) {
        this.windowMs = opts.windowMs;
        this.startCleanup();
    }

    async incr(key: string): Promise<{ current: number; reset: number }> {
        const now = Date.now();
        const windowStart = now - this.windowMs;

        let timestamps = this.data.get(key) || [];

        timestamps = timestamps.filter(ts => ts > windowStart);
        timestamps.push(now);

        this.data.set(key, timestamps);

        const reset = now + this.windowMs;

        return { current: timestamps.length, reset };
    }

    private startCleanup() {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, timestamps] of this.data) {
                const windowStart = now - this.windowMs;
                const filtered = timestamps.filter(ts => ts > windowStart);
                if (filtered.length === 0) {
                    this.data.delete(key);
                } else {
                    this.data.set(key, filtered);
                }
            }
        }, Math.min(this.windowMs, 300_000));
        this.cleanupInterval.unref()

    }

    stop() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    }

    async resetAll() {
        this.data.clear();
    }
}
