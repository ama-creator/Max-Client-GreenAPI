import { z } from 'zod';

export interface Credentials {
  idInstance: string;
  apiTokenInstance: string;
  apiUrl: string;
}

export const credentialsSchema = z.object({
  idInstance: z.string().regex(/^\d{5,20}$/, 'Введите корректный idInstance'),
  apiTokenInstance: z.string().regex(/^[a-zA-Z0-9_-]{10,256}$/, 'Проверьте apiTokenInstance'),
  apiUrl: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        /^(?:[a-z0-9-]+\.)*api\.green-api\.com$/.test(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port &&
        /^\/?$/.test(url.pathname) &&
        !url.search &&
        !url.hash
      );
    }, 'Укажите HTTPS-адрес apiUrl из личного кабинета GREEN-API'),
});

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorText(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Не удалось связаться с GREEN-API. Проверьте интернет и apiUrl.';
}

const senderSchema = z.object({
  chatId: z.string(),
  chatName: z.string().optional(),
  senderName: z.string().optional(),
  senderContactName: z.string().optional(),
  senderPhoneNumber: z.union([z.string(), z.number()]).optional(),
  chatType: z.string().optional(),
});

export const webhookSchema = z.looseObject({
  typeWebhook: z.string(),
  idMessage: z.string().optional(),
  timestamp: z.number().optional(),
  chatId: z.string().optional(),
  status: z.string().optional(),
  senderData: senderSchema.optional(),
  messageData: z
    .object({
      typeMessage: z.string(),
      textMessageData: z.object({ textMessage: z.string() }).optional(),
      extendedTextMessageData: z.object({ text: z.string() }).optional(),
    })
    .optional(),
});
export type Webhook = z.infer<typeof webhookSchema>;
const notificationSchema = z.object({ receiptId: z.number(), body: webhookSchema }).nullable();

export class GreenApi {
  constructor(private readonly credentials: Credentials) {}

  private async request<T>(
    method: string,
    schema: z.ZodType<T>,
    options: {
      body?: unknown;
      signal?: AbortSignal;
      suffix?: string;
      timeout?: number;
      verb?: string;
    } = {},
  ): Promise<T> {
    const { apiUrl, idInstance, apiTokenInstance } = this.credentials;
    const url = `${apiUrl.replace(/\/$/, '')}/waInstance${idInstance}/${method}/${apiTokenInstance}${options.suffix ?? ''}`;
    const timeout = AbortSignal.timeout(options.timeout ?? 20_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.verb ?? (options.body === undefined ? 'GET' : 'POST'),
        ...(options.body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(options.body),
            }),
        signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(
        timeout.aborted
          ? 'GREEN-API не ответил вовремя. Проверьте подключение.'
          : 'Не удалось связаться с GREEN-API. Проверьте интернет и apiUrl.',
      );
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: 'GREEN-API отклонил запрос. Проверьте номер и параметры инстанса.',
        401: 'Неверные данные доступа. Проверьте idInstance и apiTokenInstance.',
        403: 'Доступ ограничен. Проверьте токен, тариф и состояние инстанса.',
        404: 'Инстанс не найден. Проверьте idInstance и apiUrl.',
        429: 'Слишком много запросов. Подождите немного и повторите.',
        466: 'Лимит тарифа GREEN-API. Проверьте доступные чаты в личном кабинете.',
      };
      throw new ApiError(
        messages[response.status] ?? 'Сервис GREEN-API временно недоступен. Попробуйте позже.',
        response.status,
      );
    }
    try {
      return schema.parse(await response.json());
    } catch {
      throw new ApiError('GREEN-API вернул неожиданный ответ. Попробуйте позже.');
    }
  }

  async connect(signal: AbortSignal) {
    const state = await this.request('getStateInstance', z.object({ stateInstance: z.string() }), {
      signal,
    });
    if (state.stateInstance !== 'authorized')
      throw new ApiError(
        'Инстанс не авторизован в MAX. Отсканируйте QR-код в личном кабинете GREEN-API.',
      );
    const settings = await this.request(
      'getSettings',
      z.looseObject({ webhookUrl: z.string().optional(), incomingWebhook: z.string().optional() }),
      { signal },
    );
    if (settings.webhookUrl || settings.incomingWebhook !== 'yes') {
      throw new ApiError(
        'Настройте инстанс: очистите Webhook URL и включите «Получать уведомления о входящих сообщениях и файлах» в личном кабинете GREEN-API.',
      );
    }
  }

  async resolvePhone(phone: string, signal: AbortSignal) {
    const result = await this.request(
      'checkAccount',
      z.object({ exist: z.boolean(), chatId: z.string().optional() }),
      { body: { phoneNumber: Number(phone) }, signal },
    );
    if (!result.exist || !result.chatId)
      throw new ApiError(
        'Аккаунт MAX не найден. Проверьте номер и настройки приватности получателя.',
      );
    return result.chatId;
  }

  send(chatId: string, message: string, signal: AbortSignal) {
    return this.request('sendMessage', z.object({ idMessage: z.string() }), {
      body: { chatId, message },
      signal,
    });
  }
  receive(signal: AbortSignal) {
    return this.request('receiveNotification', notificationSchema, {
      signal,
      suffix: '?receiveTimeout=25',
      timeout: 35_000,
    });
  }
  async acknowledge(receiptId: number, signal: AbortSignal) {
    const result = await this.request('deleteNotification', z.object({ result: z.boolean() }), {
      signal,
      suffix: `/${receiptId}`,
      verb: 'DELETE',
    });
    if (!result.result)
      throw new ApiError('Не удалось подтвердить получение уведомления. Повторяем запрос.');
  }
}
