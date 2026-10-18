import { ApiError, errorText, type GreenApi, type Webhook } from './api';

export type Connection = {
  state: 'connected' | 'reconnecting' | 'error' | 'waiting';
  message?: string;
};
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function pollNotifications(
  api: Pick<GreenApi, 'receive' | 'acknowledge'>,
  ingest: (body: Webhook) => void,
  onConnection: (value: Connection) => void,
  signal: AbortSignal,
) {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const notification = await api.receive(signal);
      if (signal.aborted) return;
      if (notification) {
        ingest(notification.body);
        await api.acknowledge(notification.receiptId, signal);
      }
      failures = 0;
      onConnection({ state: 'connected' });
      await delay(notification ? 150 : 500, signal);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        onConnection({ state: 'error', message: errorText(error) });
        return;
      }
      onConnection({
        state: 'reconnecting',
        message:
          error instanceof Error && error.name === 'QuotaExceededError'
            ? 'Недостаточно места в хранилище вкладки. Освободите место и обновите страницу.'
            : errorText(error),
      });
      failures++;
      try {
        await delay(Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)), signal);
      } catch {
        return;
      }
    }
  }
}
