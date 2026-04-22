export class TokenBucket {
    private readonly capacity: number
    private readonly refillRatePerMs: number

    private tokens: number
    private lastRefillTs: number

    private readonly mutex = new Mutex()
    private readonly nowFn: () => number

    constructor(opts: {
        capacity: number
        refillRatePerSecond: number
        now?: () => number
    }) {
        if (opts.capacity <= 0) throw new Error("capacity must be > 0")
        if (opts.refillRatePerSecond <= 0)
            throw new Error("refillRatePerSecond must be > 0")

        this.capacity = opts.capacity
        this.refillRatePerMs = opts.refillRatePerSecond / 1000
        this.tokens = opts.capacity
        this.nowFn = opts.now ?? Date.now
        this.lastRefillTs = this.nowFn()
    }

    private refill(): void {
        const now = this.nowFn()
        const elapsedMs = now - this.lastRefillTs
        if (elapsedMs <= 0) return

        const recovered = elapsedMs * this.refillRatePerMs
        this.tokens = Math.min(this.capacity, this.tokens + recovered)
        this.lastRefillTs = now
    }

    /**
     * Mutex-protected consume
     */
    async consume(weight: number): Promise<boolean> {
        if (weight <= 0) return true
        if (weight > this.capacity) return false

        const unlock = await this.mutex.lock()
        try {
            this.refill()

            if (this.tokens < weight) {
                return false
            }

            this.tokens -= weight
            return true
        } finally {
            unlock()
        }
    }

    /**
     * Safe read (also mutexed)
     */
    async getAvailable(): Promise<number> {
        const unlock = await this.mutex.lock()
        try {
            this.refill()
            return this.tokens
        } finally {
            unlock()
        }
    }

    async getWaitTimeMs(weight: number): Promise<number> {
        const unlock = await this.mutex.lock()
        try {
            this.refill()
            if (this.tokens >= weight) return 0
            const missing = weight - this.tokens
            return Math.ceil(missing / this.refillRatePerMs)
        } finally {
            unlock()
        }
    }
}
