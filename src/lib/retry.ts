export type RetryOptions = {
  attempts?: number;
  delaysMs?: number[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class OperationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`操作等待超过 ${timeoutMs}ms`);
    this.name = 'OperationTimeoutError';
  }
}

export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timeout = globalThis.setTimeout(() => reject(new OperationTimeoutError(timeoutMs)), timeoutMs);
    const finish = (callback: () => void) => { globalThis.clearTimeout(timeout); callback(); };
    operation.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    signal?.addEventListener('abort', () => finish(() => reject(signal.reason)), { once: true });
  });
}

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
    try { return await withTimeout(operation(), options.timeoutMs ?? 0, options.signal); } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts) break;
      await wait(delays[Math.min(attempt, delays.length - 1)] ?? 0, options.signal);
    }
  }
  throw lastError;
}
