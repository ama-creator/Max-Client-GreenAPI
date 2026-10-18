import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, credentialsSchema, GreenApi } from './api';

const credentials = {
  idInstance: '3100000001',
  apiTokenInstance: 'example-token-for-tests',
  apiUrl: 'https://3100.api.green-api.com',
};
const signal = () => new AbortController().signal;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => vi.unstubAllGlobals());

describe('credentials', () => {
  it('accepts a GREEN-API HTTPS origin', () =>
    expect(credentialsSchema.safeParse(credentials).success).toBe(true));
  it.each([
    'https://evil.example',
    'https://api.green-api.com.evil.example',
    'http://3100.api.green-api.com',
    'https://user:password@3100.api.green-api.com',
    'https://3100.api.green-api.com/token',
  ])('rejects token exfiltration to %s', (apiUrl) => {
    expect(credentialsSchema.safeParse({ ...credentials, apiUrl }).success).toBe(false);
  });
});
describe('GREEN-API client', () => {
  it('sends a text message to the internal MAX chat ID', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ idMessage: 'message-id' }));
    vi.stubGlobal('fetch', fetch);
    expect(await new GreenApi(credentials).send('10000000', 'Привет', signal())).toEqual({
      idMessage: 'message-id',
    });
    expect(fetch.mock.calls[0][0]).toBe(
      'https://3100.api.green-api.com/waInstance3100000001/sendMessage/example-token-for-tests',
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      chatId: '10000000',
      message: 'Привет',
    });
  });
  it('resolves phone numbers using CheckAccount', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ exist: true, chatId: '10000000' }));
    vi.stubGlobal('fetch', fetch);
    expect(await new GreenApi(credentials).resolvePhone('79991234567', signal())).toBe('10000000');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ phoneNumber: 79991234567 });
  });
  it('rejects a nonexistent recipient', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ exist: false })));
    await expect(new GreenApi(credentials).resolvePhone('79991234567', signal())).rejects.toThrow(
      'Аккаунт MAX не найден',
    );
  });
  it('does not connect an unauthorized MAX instance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ stateInstance: 'notAuthorized' })));
    await expect(new GreenApi(credentials).connect(signal())).rejects.toThrow('не авторизован');
  });
  it('requires incoming notifications without overwriting instance settings', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(
        json({ webhookUrl: 'https://existing.example', incomingWebhook: 'yes' }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(new GreenApi(credentials).connect(signal())).rejects.toThrow(
      'очистите Webhook URL',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('handles an empty receive queue and acknowledges with DELETE', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(null))
      .mockResolvedValueOnce(json({ result: true }));
    vi.stubGlobal('fetch', fetch);
    const api = new GreenApi(credentials);
    expect(await api.receive(signal())).toBeNull();
    await api.acknowledge(123, signal());
    expect(fetch.mock.calls[1][0]).toContain('/deleteNotification/example-token-for-tests/123');
    expect(fetch.mock.calls[1][1].method).toBe('DELETE');
  });
  it('does not expose the upstream response or token in errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ secret: credentials.apiTokenInstance }, 401)),
    );
    await expect(new GreenApi(credentials).receive(signal())).rejects.toMatchObject({
      status: 401,
      message: expect.not.stringContaining(credentials.apiTokenInstance),
    });
  });
  it('validates upstream JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ unexpected: true })));
    await expect(new GreenApi(credentials).send('100', 'Hi', signal())).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
