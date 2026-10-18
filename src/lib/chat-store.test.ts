import { beforeEach, describe, expect, it } from 'vitest';
import { applyWebhook, ChatStore, normalizePhone, type ChatState } from './chat-store';
import type { Webhook } from './api';

const incoming: Webhook = {
  typeWebhook: 'incomingMessageReceived',
  idMessage: 'm1',
  timestamp: 1700000000,
  senderData: {
    chatId: '10000000',
    senderName: 'Анна',
    senderPhoneNumber: 79991234567,
    chatType: 'user',
  },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Привет!' } },
};
const initial: ChatState = {
  chats: [{ id: '10000000', name: 'Анна', phone: '79991234567', messages: [], unread: 0 }],
  activeId: '10000000',
};
beforeEach(() => sessionStorage.clear());

describe('phone input', () => {
  it.each([
    ['+7 (999) 123-45-67', '79991234567'],
    ['8 999 123 45 67', '79991234567'],
    ['+375 29 123-45-67', '375291234567'],
  ])('normalizes %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));
  it.each(['', '123', 'hello', '+7 999<script>', '00000000000'])('rejects invalid %s', (value) =>
    expect(() => normalizePhone(value)).toThrow(),
  );
});
describe('notifications', () => {
  it('routes replies to the resolved MAX ID and never duplicates receipts', () => {
    const once = applyWebhook(initial, incoming);
    expect(once.chats).toHaveLength(1);
    expect(once.chats[0].messages[0].text).toBe('Привет!');
    expect(once.chats[0].unread).toBe(0);
    expect(applyWebhook(once, incoming)).toBe(once);
  });
  it('creates a chat and unread count for an unknown sender', () => {
    const result = applyWebhook({ chats: [], activeId: null }, incoming);
    expect(result.chats[0]).toMatchObject({ id: '10000000', name: 'Анна', unread: 1 });
  });
  it('supports text containing a link', () => {
    const result = applyWebhook(initial, {
      ...incoming,
      messageData: {
        typeMessage: 'extendedTextMessage',
        extendedTextMessageData: { text: 'https://example.com' },
      },
    });
    expect(result.chats[0].messages[0].text).toBe('https://example.com');
  });
  it('ignores media and service events', () => {
    expect(applyWebhook(initial, { typeWebhook: 'stateInstanceChanged' })).toBe(initial);
    expect(
      applyWebhook(initial, { ...incoming, messageData: { typeMessage: 'imageMessage' } }),
    ).toBe(initial);
  });
  it('does not acknowledge incomplete text silently', () => {
    expect(() => applyWebhook(initial, { ...incoming, idMessage: undefined })).toThrow();
  });
  it('does not downgrade delivery when webhooks arrive out of order', () => {
    const state: ChatState = {
      ...initial,
      chats: [
        {
          ...initial.chats[0],
          messages: [{ id: 'm2', text: 'test', timestamp: 0, direction: 'out', status: 'read' }],
        },
      ],
    };
    const result = applyWebhook(state, {
      typeWebhook: 'outgoingMessageStatus',
      idMessage: 'm2',
      status: 'sent',
    });
    expect(result.chats[0].messages[0].status).toBe('read');
  });
});
describe('session store', () => {
  it('persists and restores messages without credentials', () => {
    const store = new ChatStore('account', initial);
    store.ingest(incoming);
    expect(new ChatStore('account').getSnapshot().chats[0].messages).toHaveLength(1);
    expect(new ChatStore('different').getSnapshot().chats).toHaveLength(0);
    store.clear();
    expect(new ChatStore('account').getSnapshot().chats).toHaveLength(0);
  });
  it('recovers from corrupt storage', () => {
    sessionStorage.setItem('max-chat:v1:broken', '{invalid');
    expect(new ChatStore('broken').getSnapshot().chats).toHaveLength(0);
  });
  it('marks a send interrupted by reload as uncertain', () => {
    const store = new ChatStore('account', initial);
    store.addMessage('10000000', {
      id: 'pending',
      text: 'Hi',
      timestamp: 0,
      direction: 'out',
      status: 'sending',
    });
    expect(new ChatStore('account').getSnapshot().chats[0].messages[0].status).toBe('uncertain');
  });
  it('reconciles a delivery status received before the send response', () => {
    const store = new ChatStore('account', initial);
    store.addMessage('10000000', {
      id: 'local',
      text: 'Hi',
      timestamp: 0,
      direction: 'out',
      status: 'sending',
    });
    store.ingest({ typeWebhook: 'outgoingMessageStatus', idMessage: 'server', status: 'read' });
    store.ingest({ typeWebhook: 'outgoingMessageStatus', idMessage: 'server', status: 'sent' });
    store.patchMessage('10000000', 'local', { id: 'server', status: 'sent' });
    expect(store.getSnapshot().chats[0].messages[0].status).toBe('read');
  });
});
