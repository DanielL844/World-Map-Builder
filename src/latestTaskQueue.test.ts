import { describe, expect, it, vi } from 'vitest';
import { LatestTaskQueue } from './latestTaskQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('LatestTaskQueue', () => {
  it('finishes the active task, then runs only the newest queued value', async () => {
    const first = deferred();
    const started: number[] = [];
    const queue = new LatestTaskQueue<number>(async (value) => {
      started.push(value);
      if (value === 1) await first.promise;
    });

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    expect(started).toEqual([1]);

    first.resolve();
    await vi.waitFor(() => expect(started).toEqual([1, 3]));
  });

  it('continues with the newest value after a task fails', async () => {
    const errors: unknown[] = [];
    const started: number[] = [];
    const queue = new LatestTaskQueue<number>(async (value) => {
      started.push(value);
      if (value === 1) throw new Error('save failed');
    }, (error) => errors.push(error));

    queue.enqueue(1);
    queue.enqueue(2);

    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    expect(errors).toHaveLength(1);
  });
});
