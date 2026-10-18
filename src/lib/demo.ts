import type { ChatState } from './chat-store';

export function demoState(): ChatState {
  const now = Date.now();
  return {
    activeId: 'demo-1',
    chats: [
      {
        id: 'demo-1',
        name: 'Александра',
        phone: '79991234567',
        unread: 0,
        messages: [
          {
            id: 'd1',
            text: 'Привет! Здесь будем на связи 👋',
            timestamp: now - 600_000,
            direction: 'in',
            status: 'sent',
          },
          {
            id: 'd2',
            text: 'Привет, Саша! Да, всё работает.',
            timestamp: now - 540_000,
            direction: 'out',
            status: 'read',
          },
          {
            id: 'd3',
            text: 'Как здорово, когда всё просто. Написал — и уже на связи.',
            timestamp: now - 480_000,
            direction: 'in',
            status: 'sent',
          },
          {
            id: 'd4',
            text: 'Согласен! Ничего лишнего 🙂',
            timestamp: now - 420_000,
            direction: 'out',
            status: 'read',
          },
          {
            id: 'd5',
            text: 'Тогда до встречи! Хорошего дня ☀️',
            timestamp: now - 360_000,
            direction: 'in',
            status: 'sent',
          },
        ],
      },
      {
        id: 'demo-2',
        name: 'Михаил',
        phone: '79997654321',
        unread: 1,
        messages: [
          {
            id: 'd6',
            text: 'Отлично, договорились 🤝',
            timestamp: now - 3_600_000,
            direction: 'in',
            status: 'sent',
          },
        ],
      },
      {
        id: 'demo-3',
        name: 'Анна',
        phone: '79995553322',
        unread: 0,
        messages: [
          {
            id: 'd7',
            text: 'Спасибо! До завтра',
            timestamp: now - 7_200_000,
            direction: 'out',
            status: 'read',
          },
        ],
      },
    ],
  };
}
