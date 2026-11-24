import type { Pool, PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_FRESH_MS, CACHE_MIN_VEHICLES, CACHE_STALE_MS, remembered } from "./query";

/** A pool as remembered sees it: an object without release(). Each test gets its own cache. */
const fakePool = () => ({}) as Pool;

/** load() returning the given counts one after another, counting its calls. */
function loader(...values: number[]) {
  const load = vi.fn(async () => values[Math.min(load.mock.calls.length - 1, values.length - 1)]);
  return load;
}

const big = CACHE_MIN_VEHICLES;
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("remembered", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a large result while it is fresh", async () => {
    const pool = fakePool();
    const load = loader(big, big + 1);
    expect(await remembered(pool, "k", load, (n) => n)).toBe(big);
    vi.advanceTimersByTime(CACHE_FRESH_MS - 1);
    expect(await remembered(pool, "k", load, (n) => n)).toBe(big);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("counts a small result anew every time", async () => {
    const pool = fakePool();
    const load = loader(big - 1, 5);
    expect(await remembered(pool, "k", load, (n) => n)).toBe(big - 1);
    expect(await remembered(pool, "k", load, (n) => n)).toBe(5);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("serves a stale result at once and refreshes it in the background", async () => {
    const pool = fakePool();
    const load = loader(big, big + 7);
    await remembered(pool, "k", load, (n) => n);
    vi.advanceTimersByTime(CACHE_FRESH_MS);
    expect(await remembered(pool, "k", load, (n) => n)).toBe(big);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(await remembered(pool, "k", load, (n) => n)).toBe(big + 7);
  });

  it("waits for a new result once the old one is too old", async () => {
    const pool = fakePool();
    const load = loader(big, big + 7);
    await remembered(pool, "k", load, (n) => n);
    vi.advanceTimersByTime(CACHE_STALE_MS);
    expect(await remembered(pool, "k", load, (n) => n)).toBe(big + 7);
  });

  it("keeps the stale result when the refresh fails", async () => {
    const pool = fakePool();
    await remembered(pool, "k", async () => big, (n) => n);
    vi.advanceTimersByTime(CACHE_FRESH_MS);
    const failing = vi.fn(async (): Promise<number> => {
      throw new Error("database gone");
    });
    expect(await remembered(pool, "k", failing, (n) => n)).toBe(big);
    await flush();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await remembered(pool, "k", failing, (n) => n)).toBe(big);
  });

  it("runs one query for requests that arrive while it runs", async () => {
    const pool = fakePool();
    const load = loader(big);
    const results = await Promise.all([1, 2, 3].map(() => remembered(pool, "k", load, (n) => n)));
    expect(results).toEqual([big, big, big]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps results apart by key and by pool", async () => {
    const [a, b] = [fakePool(), fakePool()];
    await remembered(a, "k", loader(big), (n) => n);
    expect(await remembered(a, "other", loader(big + 1), (n) => n)).toBe(big + 1);
    expect(await remembered(b, "k", loader(big + 2), (n) => n)).toBe(big + 2);
  });

  it("always asks inside a transaction (a client)", async () => {
    const client = { release() {} } as unknown as PoolClient;
    const load = loader(big, big + 1);
    expect(await remembered(client, "k", load, (n) => n)).toBe(big);
    expect(await remembered(client, "k", load, (n) => n)).toBe(big + 1);
  });
});
