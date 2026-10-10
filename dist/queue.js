import { UserError } from './errors.js';
export class TrackQueue {
    limit;
    current = null;
    tracks = [];
    history = [];
    repeat = 'off';
    constructor(limit) {
        this.limit = limit;
    }
    add(tracks) {
        const accepted = tracks.slice(0, Math.max(0, this.limit - this.tracks.length));
        this.tracks.push(...accepted);
        return accepted.length;
    }
    next(reason = 'finished') {
        const previous = this.current;
        if (previous && reason === 'finished' && this.repeat === 'track')
            return previous;
        if (previous) {
            this.history.push(previous);
            this.history = this.history.slice(-50);
            if (reason === 'finished' && this.repeat === 'queue')
                this.tracks.push(previous);
        }
        this.current = this.tracks.shift() ?? null;
        return this.current;
    }
    previous() {
        const track = this.history.pop();
        if (!track)
            throw new UserError('Chưa có bài trước đó.');
        if (this.current) {
            if (this.tracks.length >= this.limit) {
                this.history.push(track);
                throw new UserError('Hàng đợi đã đầy. Hãy xóa một bài trước.');
            }
            this.tracks.unshift(this.current);
        }
        this.current = track;
        return track;
    }
    remove(index) {
        this.assertIndex(index);
        return this.tracks.splice(index - 1, 1)[0];
    }
    move(from, to) {
        this.assertIndex(from);
        this.assertIndex(to);
        this.tracks.splice(to - 1, 0, this.tracks.splice(from - 1, 1)[0]);
    }
    shuffle(random = Math.random) {
        for (let i = this.tracks.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
        }
    }
    clear() { this.tracks = []; }
    assertIndex(index) {
        if (!Number.isInteger(index) || index < 1 || index > this.tracks.length)
            throw new UserError('Vị trí bài hát không hợp lệ. Dùng /queue để xem danh sách.');
    }
}
export class SerialExecutor {
    tails = new Map();
    async run(key, task) {
        const previous = this.tails.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(task);
        this.tails.set(key, next);
        try {
            return await next;
        }
        finally {
            if (this.tails.get(key) === next)
                this.tails.delete(key);
        }
    }
}
//# sourceMappingURL=queue.js.map