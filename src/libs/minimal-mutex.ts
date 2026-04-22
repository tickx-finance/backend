class Mutex {
    private locked = false
    private waiters: Array<() => void> = []

    async lock(): Promise<() => void> {
        return new Promise(resolve => {
            const unlock = () => {
                const next = this.waiters.shift()
                if (next) {
                    next()
                } else {
                    this.locked = false
                }
            }

            if (this.locked) {
                this.waiters.push(() => resolve(unlock))
            } else {
                this.locked = true
                resolve(unlock)
            }
        })
    }
}
