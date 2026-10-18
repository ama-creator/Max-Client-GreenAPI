import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { pollNotifications } from './polling';

afterEach(() => vi.useRealTimers());
it('persists before acknowledging and reprocesses a receipt after an ACK failure', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const events: string[] = [];
  const receipt = { receiptId: 7, body: { typeWebhook: 'stateInstanceChanged' } };
  const api = {
    receive: vi.fn().mockResolvedValue(receipt),
    acknowledge: vi
      .fn()
      .mockImplementationOnce(async () => {
        events.push('ack-failed');
        throw new ApiError('Unavailable', 500);
      })
      .mockImplementationOnce(async () => {
        events.push('ack-ok');
        abort.abort();
      }),
  };
  const task = pollNotifications(api, () => events.push('persist'), vi.fn(), abort.signal);
  await vi.advanceTimersByTimeAsync(1000);
  await task;
  expect(events).toEqual(['persist', 'ack-failed', 'persist', 'ack-ok']);
});
it('never acknowledges a message that could not be persisted', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const api = {
    receive: vi
      .fn()
      .mockResolvedValue({ receiptId: 8, body: { typeWebhook: 'incomingMessageReceived' } }),
    acknowledge: vi.fn(),
  };
  const task = pollNotifications(
    api,
    () => {
      throw new DOMException('Full', 'QuotaExceededError');
    },
    vi.fn(),
    abort.signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  abort.abort();
  await task;
  expect(api.acknowledge).not.toHaveBeenCalled();
});
it('stops retrying on invalid credentials', async () => {
  const api = {
    receive: vi.fn().mockRejectedValue(new ApiError('Неверный токен', 401)),
    acknowledge: vi.fn(),
  };
  const connection = vi.fn();
  await pollNotifications(api, vi.fn(), connection, new AbortController().signal);
  expect(api.receive).toHaveBeenCalledTimes(1);
  expect(connection).toHaveBeenCalledWith({ state: 'error', message: 'Неверный токен' });
});
