export type RetryOptions = {
  attempts?: number;
  delaysMs?: number[];
  signal?: AbortSignal;
};

const wait = (delayMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timeout = globalThis.setTimeout(resolve, delayMs);
  signal?.addEventListener('abort', () => {
    globalThis.clearTimeout(timeout);
    reject(signal.reason);
  }, { once: true });
});

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.round(options.attempts ?? 3));
  const delays = options.delaysMs ?? [350, 900];
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason;
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
      await wait(delays[Math.min(attempt, delays.length - 1)] ?? 0, options.signal);
    }
  }
  throw lastError;
}
