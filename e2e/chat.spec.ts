import { expect, test, type Page } from '@playwright/test';

test('demo: search, create chat, send, receive, exit', async ({ page, isMobile }, testInfo) => {
  await page.goto('/');
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
  await page.getByRole('button', { name: 'Открыть демоверсию' }).click();
  await expect(page.getByRole('heading', { name: 'Александра', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('chat.png'), fullPage: true });
  if (isMobile) await page.getByRole('button', { name: 'Назад к чатам' }).click();
  await page.getByRole('textbox', { name: 'Поиск чатов' }).fill('Михаил');
  await expect(
    page.getByRole('navigation', { name: 'Чаты', exact: true }).getByRole('button'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Очистить поиск' }).click();
  await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
  await page.getByLabel('Номер телефона', { exact: true }).fill('+7 999 111-22-33');
  await page.getByLabel('Имя необязательно').fill('Тестовый контакт');
  await page.getByRole('button', { name: 'Начать разговор' }).click();
  await page.getByRole('textbox', { name: 'Текст сообщения' }).fill('Привет из теста');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByRole('log').getByText('Привет из теста', { exact: true })).toBeVisible();
  await expect(page.getByRole('log').getByText('Это демоверсия', { exact: false })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Назад к чатам' }).click();
  await page.getByRole('button', { name: /Демоаккаунт/ }).click();
  await page.getByRole('button', { name: 'Выйти и подключить аккаунт' }).click();
  await expect(page.getByRole('heading', { name: 'Добро пожаловать' })).toBeVisible();
});

async function mockApi(page: Page) {
  let sent = false;
  let acked = false;
  await page.route('https://3100.api.green-api.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/getStateInstance/'))
      return route.fulfill({ json: { stateInstance: 'authorized' } });
    if (url.includes('/getSettings/'))
      return route.fulfill({ json: { webhookUrl: '', incomingWebhook: 'yes' } });
    if (url.includes('/checkAccount/'))
      return route.fulfill({ json: { exist: true, chatId: '10000000' } });
    if (url.includes('/sendMessage/')) {
      expect(route.request().postDataJSON()).toEqual({ chatId: '10000000', message: 'Тест MAX' });
      sent = true;
      return route.fulfill({ json: { idMessage: 'sent-id' } });
    }
    if (url.includes('/deleteNotification/')) {
      expect(route.request().method()).toBe('DELETE');
      acked = true;
      return route.fulfill({ json: { result: true } });
    }
    if (url.includes('/receiveNotification/')) {
      if (sent && !acked)
        return route.fulfill({
          json: {
            receiptId: 1,
            body: {
              typeWebhook: 'incomingMessageReceived',
              idMessage: 'reply',
              timestamp: Math.floor(Date.now() / 1000),
              senderData: {
                chatId: '10000000',
                senderName: 'Тест',
                senderPhoneNumber: 79991234567,
                chatType: 'user',
              },
              messageData: {
                typeMessage: 'textMessage',
                textMessageData: { textMessage: 'Ответ из MAX' },
              },
            },
          },
        });
      return route.fulfill({ json: null });
    }
    return route.abort();
  });
  return { wasAcked: () => acked };
}

test('GREEN-API: login, resolve MAX ID, send text, receive and ACK reply', async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto('/');
  await page.getByLabel('ID инстанса idInstance').fill('3100000001');
  await page.getByLabel('API-токен apiTokenInstance').fill('example-token-for-tests');
  await page.getByLabel('Адрес API apiUrl').fill('https://3100.api.green-api.com');
  await page.getByRole('button', { name: 'Подключиться к MAX' }).click();
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click();
  await page.getByLabel('Номер телефона', { exact: true }).fill('+7 999 123-45-67');
  await page.getByRole('button', { name: 'Начать разговор' }).click();
  await page.getByRole('textbox', { name: 'Текст сообщения' }).fill('Тест MAX');
  await page.getByRole('textbox', { name: 'Текст сообщения' }).press('Enter');
  await expect(page.getByRole('log').getByText('Ответ из MAX', { exact: true })).toBeVisible();
  await expect.poll(mock.wasAcked).toBe(true);
  await expect(page.getByRole('log').getByText('Тест MAX', { exact: true })).toHaveCount(1);
  const persisted = await page.evaluate(() => Object.values(sessionStorage).join(''));
  expect(persisted).not.toContain('example-token-for-tests');
});

test('login reports invalid credentials', async ({ page }) => {
  await page.route('https://3100.api.green-api.com/**', (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto('/');
  await page.getByLabel('ID инстанса idInstance').fill('3100000001');
  await page.getByLabel('API-токен apiTokenInstance').fill('example-token-for-tests');
  await page.getByLabel('Адрес API apiUrl').fill('https://3100.api.green-api.com');
  await page.getByRole('button', { name: 'Подключиться к MAX' }).click();
  await expect(page.getByRole('alert')).toContainText('Неверные данные доступа');
});
