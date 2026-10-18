import { z } from 'zod';
import type { Webhook } from './api';

const messageSchema = z.object({
  id: z.string(),
  text: z.string(),
  timestamp: z.number(),
  direction: z.enum(['in', 'out']),
  status: z.enum(['sending', 'sent', 'delivered', 'read', 'failed', 'uncertain']),
  error: z.string().optional(),
});
const chatSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  unread: z.number(),
  messages: z.array(messageSchema),
});
export type Message = z.infer<typeof messageSchema>;
export type Chat = z.infer<typeof chatSchema>;
export interface ChatState {
  chats: Chat[];
  activeId: string | null;
}
const stateSchema = z.object({ chats: z.array(chatSchema), activeId: z.string().nullable() });
const emptyState: ChatState = { chats: [], activeId: null };
const statusOrder = { sending: 0, uncertain: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

export function normalizePhone(value: string): string {
  const digits = value.replace(/[\s()+-]/g, '');
  const phone = /^8\d{10}$/.test(digits) ? `7${digits.slice(1)}` : digits;
  if (!/^[1-9]\d{6,14}$/.test(phone))
    throw new Error('Введите номер в международном формате, например +7 999 123-45-67');
  return phone;
}
export function formatPhone(phone: string) {
  return /^7\d{10}$/.test(phone)
    ? `+7 ${phone.slice(1, 4)} ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9)}`
    : phone
      ? `+${phone}`
      : 'Пользователь MAX';
}

export function applyWebhook(state: ChatState, body: Webhook): ChatState {
  if (body.typeWebhook === 'outgoingMessageStatus' && body.idMessage && body.status) {
    const status = body.status;
    if (!['sent', 'delivered', 'read', 'failed'].includes(status)) return state;
    return {
      ...state,
      chats: state.chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) =>
          message.id === body.idMessage &&
          message.direction === 'out' &&
          statusOrder[status as Message['status']] >= statusOrder[message.status]
            ? {
                ...message,
                status: status as Message['status'],
                ...(status === 'failed' ? { error: 'MAX не смог доставить сообщение.' } : {}),
              }
            : message,
        ),
      })),
    };
  }
  const incoming = body.typeWebhook === 'incomingMessageReceived';
  const outgoing = ['outgoingAPIMessageReceived', 'outgoingMessageReceived'].includes(
    body.typeWebhook,
  );
  if (!incoming && !outgoing) return state;
  const data = body.messageData;
  if (!data || !['textMessage', 'extendedTextMessage'].includes(data.typeMessage)) return state;
  if (!body.senderData || !body.idMessage || body.timestamp === undefined)
    throw new Error('Неполное текстовое уведомление');
  if (body.senderData.chatType === 'group' || body.senderData.chatId.startsWith('-')) return state;
  const text =
    data.typeMessage === 'textMessage'
      ? data.textMessageData?.textMessage
      : data.extendedTextMessageData?.text;
  if (text === undefined) throw new Error('В уведомлении отсутствует текст');
  const sender = body.senderData;
  const phone = sender.senderPhoneNumber ? String(sender.senderPhoneNumber) : '';
  const existing = state.chats.find(
    (chat) => chat.id === sender.chatId || (phone && chat.phone === phone),
  );
  if (existing?.messages.some((message) => message.id === body.idMessage)) return state;
  const name =
    sender.senderContactName || sender.senderName || sender.chatName || formatPhone(phone);
  const chat: Chat = existing ?? { id: sender.chatId, phone, name, unread: 0, messages: [] };
  const message: Message = {
    id: body.idMessage,
    text,
    timestamp: body.timestamp * 1000,
    direction: incoming ? 'in' : 'out',
    status: 'sent',
  };
  const updated: Chat = {
    ...chat,
    id: sender.chatId,
    name: incoming ? name : chat.name,
    unread: chat.unread + (incoming && state.activeId !== chat.id ? 1 : 0),
    messages: [...chat.messages, message].sort((a, b) => a.timestamp - b.timestamp),
  };
  return {
    ...state,
    activeId: state.activeId === chat.id ? updated.id : state.activeId,
    chats: [...state.chats.filter((c) => c !== existing), updated],
  };
}

export class ChatStore {
  private state: ChatState;
  private listeners = new Set<() => void>();
  private pendingStatuses = new Map<string, Webhook>();
  private key: string;
  constructor(account: string, initial?: ChatState) {
    this.key = `max-chat:v1:${account}`;
    this.state = initial ?? emptyState;
    if (!initial) {
      try {
        const stored = sessionStorage.getItem(this.key);
        if (stored) {
          this.state = stateSchema.parse(JSON.parse(stored));
          this.state = {
            ...this.state,
            chats: this.state.chats.map((chat) => ({
              ...chat,
              messages: chat.messages.map((message) =>
                message.status === 'sending'
                  ? {
                      ...message,
                      status: 'uncertain',
                      error:
                        'Статус отправки неизвестен после перезагрузки. Проверьте MAX перед повторной отправкой.',
                    }
                  : message,
              ),
            })),
          };
        }
      } catch {
        this.state = emptyState;
      }
    }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update = (change: (state: ChatState) => ChatState) => {
    const next = change(this.state);
    // Persist before acknowledging a webhook so a reload cannot lose an accepted message.
    sessionStorage.setItem(this.key, JSON.stringify(next));
    this.state = next;
    this.listeners.forEach((listener) => listener());
  };
  select(id: string | null) {
    this.update((state) => ({
      ...state,
      activeId: id,
      chats: state.chats.map((chat) => (chat.id === id ? { ...chat, unread: 0 } : chat)),
    }));
  }
  add(id: string, phone: string, name: string) {
    this.update((state) => ({
      ...state,
      activeId: id,
      chats: state.chats.some((chat) => chat.id === id)
        ? state.chats.map((chat) => (chat.id === id ? { ...chat, unread: 0 } : chat))
        : [
            ...state.chats,
            { id, phone, name: name.trim() || formatPhone(phone), unread: 0, messages: [] },
          ],
    }));
  }
  addMessage(chatId: string, message: Message) {
    this.update((state) => ({
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, messages: [...chat.messages, message] } : chat,
      ),
    }));
  }
  patchMessage(chatId: string, id: string, patch: Partial<Message>) {
    this.update((state) => {
      let next = {
        ...state,
        chats: state.chats.map((chat) => {
          if (chat.id !== chatId) return chat;
          const echo = patch.id
            ? chat.messages.find((message) => message.id === patch.id && message.id !== id)
            : undefined;
          const messages = chat.messages
            .map((message) => {
              if (message.id !== id) return message;
              const updated = { ...message, ...patch };
              if (echo && statusOrder[echo.status] > statusOrder[updated.status])
                updated.status = echo.status;
              return updated;
            })
            .filter(
              (message, index, all) => all.findIndex((other) => other.id === message.id) === index,
            );
          return { ...chat, messages };
        }),
      };
      const status = patch.id ? this.pendingStatuses.get(patch.id) : undefined;
      if (status) next = applyWebhook(next, status);
      return next;
    });
    if (patch.id) this.pendingStatuses.delete(patch.id);
  }
  ingest(body: Webhook) {
    if (
      body.typeWebhook === 'outgoingMessageStatus' &&
      body.idMessage &&
      !this.state.chats.some((chat) =>
        chat.messages.some((message) => message.id === body.idMessage),
      )
    ) {
      // Status webhooks can arrive before SendMessage returns its server ID.
      const previous = this.pendingStatuses.get(body.idMessage);
      const rank = (status?: string) => statusOrder[status as Message['status']] ?? -1;
      if (!previous || rank(body.status) >= rank(previous.status))
        this.pendingStatuses.set(body.idMessage, body);
      if (this.pendingStatuses.size > 500)
        this.pendingStatuses.delete(this.pendingStatuses.keys().next().value!);
    }
    this.update((state) => applyWebhook(state, body));
  }
  clear() {
    sessionStorage.removeItem(this.key);
    this.state = emptyState;
    this.listeners.forEach((listener) => listener());
  }
}
