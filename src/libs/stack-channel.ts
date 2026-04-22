
export class StackChannel<T> {
    private stack: T[] = [];
    private resolvers: ((value: T) => void)[] = [];
    private closed = false;

    send(msg: T) {
        if (this.closed) return;

        if (this.resolvers.length > 0) {
            const resolve = this.resolvers.shift()!;
            resolve(msg);
        } else {
            this.stack.push(msg);
        }
    }

    async receive(): Promise<T> {
        if (this.stack.length > 0) {
            return this.stack.pop()!;
        }

        if (this.closed) {
            throw new Error('Channel closed');
        }

        return new Promise<T>(resolve => {
            this.resolvers.push(resolve);
        });
    }

    close() {
        this.closed = true;
        this.resolvers = [];
    }

    get length() {
        return this.stack.length;
    }
}
