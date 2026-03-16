import type {RateLimitStore} from "./storage";

export class MemoryStore implements RateLimitStore {
    private readonly windowMs: number;
    private data = new Map<string, { count: number; reset: number }>();
    private cleanupInterval?: NodeJS.Timeout;

    constructor(opts: { windowMs: number }) {
        this.windowMs = opts.windowMs;
        this.startCleanup();
    }

    async incr(key: string): Promise<{ current: number; reset: number }> {
        const now = Date.now();
        let record = this.data.get(key);

        if (!record || now >= record.reset) {
            const reset = now + this.windowMs;
            record = {count: 1, reset};
            this.data.set(key, record);
        } else {
            record.count++;
        }

        return {current: record.count, reset: record.reset};
    }

    private startCleanup() {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, {reset}] of this.data) {
                if (now >= reset) {
                    this.data.delete(key);
                }
            }
        }, Math.min(this.windowMs, 300_000)); // Max 5 min interval
    }

    stop() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    }

    async resetAll() {
        this.data.clear();
    }
}
