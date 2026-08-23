import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationTimeoutError, retry, withTimeout } from './retry';

afterEach(() => vi.useRealTimers());

describe('retry', () => {
  it('recovers from a temporary failure without retrying after success', async () => {
    vi.useFakeTimers();
    const operation = vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue('ready');
    const result = retry(operation, { attempts: 3, delaysMs: [10] });
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toBe('ready');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('stops after the configured number of attempts', async () => {
    vi.useFakeTimers();
    const operation = vi.fn().mockRejectedValue(new Error('offline'));
    const result = retry(operation, { attempts: 2, delaysMs: [10] });
    const assertion = expect(result).rejects.toThrow('offline');
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('rejects an operation that never settles', async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<string>(() => undefined), 50);
    const assertion = expect(result).rejects.toBeInstanceOf(OperationTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('retries after a timed-out attempt', async () => {
    vi.useFakeTimers();
    const operation = vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValue('ready');
    const result = retry(operation, { attempts: 2, delaysMs: [10], timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    await expect(result).resolves.toBe('ready');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
