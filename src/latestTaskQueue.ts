// Runs one async task at a time while retaining only the newest value queued behind it.
// This is useful for autosave: intermediate snapshots may be skipped, but an older write can
// never finish after a newer write and replace it in persistent storage.
export class LatestTaskQueue<T> {
  private latest: { value: T } | null = null;
  private running = false;

  constructor(
    private readonly task: (value: T) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  enqueue(value: T): void {
    this.latest = { value };
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.latest) {
        const next = this.latest;
        this.latest = null;
        try {
          await this.task(next.value);
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.running = false;
      // An enqueue cannot interleave with the synchronous end of the loop, but this also keeps
      // the queue safe if an error callback itself enqueues another value.
      if (this.latest) void this.drain();
    }
  }
}
