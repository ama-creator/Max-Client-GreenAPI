import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  Info,
  LoaderCircle,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Smile,
  X,
} from 'lucide-react';
import { ApiError, errorText, GreenApi, type Credentials } from './lib/api';
import { ChatStore, formatPhone, normalizePhone, type Chat, type Message } from './lib/chat-store';
import { demoState } from './lib/demo';
import { delay, pollNotifications, type Connection } from './lib/polling';
import { Login } from './components/Login';
import { Modal } from './components/Modal';

interface Session {
  credentials: Credentials | null;
  store: ChatStore;
  api: GreenApi | null;
}
const time = (stamp: number) =>
  new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(stamp);
const date = (stamp: number) =>
  new Date(stamp).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
function dayLabel(stamp: number) {
  return new Date(stamp).toDateString() === new Date().toDateString() ? 'Сегодня' : date(stamp);
}
function avatarColor(name: string) {
  return ['lilac', 'mint', 'peach', 'sky'][
    [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4
  ];
}
function Avatar({ chat, large = false }: { chat: Chat; large?: boolean }) {
  return (
    <span className={`avatar ${avatarColor(chat.name)} ${large ? 'large' : ''}`} aria-hidden="true">
      {chat.name.startsWith('+') ? (
        <MessageCircle size={large ? 24 : 21} />
      ) : (
        chat.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
const statusLabels: Record<Message['status'], string> = {
  sending: 'Отправляется',
  sent: 'Отправлено в GREEN-API',
  delivered: 'Доставлено',
  read: 'Прочитано',
  failed: 'Не отправлено',
  uncertain: 'Статус отправки неизвестен',
};
function MessageStatus({ status }: { status: Message['status'] }) {
  return (
    <span
      className={`message-status status-${status}`}
      title={statusLabels[status]}
      aria-label={statusLabels[status]}
    >
      {status === 'sending' ? (
        <Clock3 size={13} />
      ) : ['failed', 'uncertain'].includes(status) ? (
        <CircleAlert size={14} />
      ) : ['read', 'delivered'].includes(status) ? (
        <CheckCheck size={16} />
      ) : (
        <Check size={15} />
      )}
    </span>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  return session ? (
    <Messenger
      key={session.credentials?.idInstance ?? 'demo'}
      session={session}
      onLogout={() => setSession(null)}
    />
  ) : (
    <Login
      onConnect={(credentials) =>
        setSession({
          credentials,
          store: new ChatStore(credentials.idInstance),
          api: new GreenApi(credentials),
        })
      }
      onDemo={() =>
        setSession({ credentials: null, store: new ChatStore('demo', demoState()), api: null })
      }
    />
  );
}

function Messenger({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { store, api, credentials } = session;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const active = state.chats.find((chat) => chat.id === state.activeId);
  const demo = !api;
  const [connection, setConnection] = useState<Connection>({ state: 'connected' });
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'new' | 'account' | 'info' | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const lifecycle = useRef(new AbortController());
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const draft = active ? (drafts[active.id] ?? '') : '';

  useEffect(() => {
    const abort = new AbortController();
    lifecycle.current = abort;
    if (api) {
      const run = () =>
        pollNotifications(api, (body) => store.ingest(body), setConnection, abort.signal);
      if (navigator.locks) {
        setConnection({
          state: 'waiting',
          message: 'Ожидаем завершения получения сообщений в другой вкладке.',
        });
        void navigator.locks
          .request(`max-receive:${credentials!.idInstance}`, { signal: abort.signal }, async () => {
            setConnection({ state: 'connected' });
            await run();
          })
          .catch(() => {
            if (!abort.signal.aborted)
              setConnection({
                state: 'error',
                message: 'Не удалось запустить получение сообщений. Обновите страницу.',
              });
          });
      } else void run();
    }
    return () => abort.abort();
  }, [api, credentials, store]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active?.id, active?.messages.length]);
  useEffect(() => {
    setEmojiOpen(false);
  }, [active?.id]);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = '0px';
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 144)}px`;
    }
  }, [draft]);
  useEffect(() => {
    const onOnline = () => {
      if (!demo) setNotice('Соединение восстановлено. Ожидаем ответ GREEN-API.');
    };
    const onOffline = () => {
      if (!demo)
        setConnection({
          state: 'reconnecting',
          message: 'Нет подключения к интернету. Восстановим соединение автоматически.',
        });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [demo]);

  function selectChat(id: string | null) {
    try {
      store.select(id);
      setNotice('');
    } catch {
      setNotice('Не удалось сохранить чат. Проверьте доступность хранилища браузера.');
    }
  }
  function logout() {
    lifecycle.current.abort();
    try {
      store.clear();
    } finally {
      onLogout();
    }
  }
  async function sendMessage(chat: Chat, text: string, retryId?: string) {
    if (!text.trim() || text.length > 4000 || pending.current.has(chat.id)) return;
    const id = retryId ?? crypto.randomUUID();
    pending.current.add(chat.id);
    setSending(new Set(pending.current));
    try {
      if (retryId) store.patchMessage(chat.id, id, { status: 'sending', error: undefined });
      else
        store.addMessage(chat.id, {
          id,
          text: text.trim(),
          direction: 'out',
          status: 'sending',
          timestamp: Date.now(),
        });
      setDrafts((value) => ({ ...value, [chat.id]: '' }));
      setEmojiOpen(false);
      setNotice('');
      const signal = lifecycle.current.signal;
      if (api) {
        const result = await api.send(chat.id, text.trim(), signal);
        if (!signal.aborted)
          store.patchMessage(chat.id, id, { id: result.idMessage, status: 'sent' });
      } else {
        await delay(500, signal);
        store.patchMessage(chat.id, id, { status: 'delivered' });
        await delay(1200, signal);
        store.addMessage(chat.id, {
          id: crypto.randomUUID(),
          text: 'Это демоверсия 🙂 Подключите GREEN-API, чтобы отправлять настоящие сообщения в MAX.',
          direction: 'in',
          status: 'sent',
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      if (!lifecycle.current.signal.aborted) {
        const uncertain = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
        try {
          store.patchMessage(chat.id, id, {
            status: uncertain ? 'uncertain' : 'failed',
            error: uncertain
              ? 'Статус неизвестен. Проверьте MAX перед повторной отправкой, чтобы избежать дубликата.'
              : errorText(error),
          });
        } catch {
          setNotice('Не удалось сохранить сообщение. Проверьте хранилище браузера.');
        }
      }
    } finally {
      pending.current.delete(chat.id);
      if (!lifecycle.current.signal.aborted) setSending(new Set(pending.current));
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (active) void sendMessage(active, draft);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (active) void sendMessage(active, draft);
    }
  }
  const chats = [...state.chats]
    .sort((a, b) => (b.messages.at(-1)?.timestamp ?? 0) - (a.messages.at(-1)?.timestamp ?? 0))
    .filter((chat) => `${chat.name} ${chat.phone}`.toLowerCase().includes(search.toLowerCase()));
  const unread = state.chats.reduce((sum, chat) => sum + chat.unread, 0);

  return (
    <main className={`messenger ${active ? 'has-active' : ''}`}>
      <aside className="sidebar" aria-label="Список чатов">
        <header className="sidebar-header">
          <div className="brand">
            <img src="/favicon.svg" alt="" />
            <span>MAX</span>
            <span className="web-label">web</span>
          </div>
          <button
            className="icon-button new-chat-icon"
            aria-label="Новый чат"
            title="Новый чат"
            onClick={() => setModal('new')}
          >
            <MessageSquarePlus size={22} />
          </button>
        </header>
        <div className="search-wrap">
          <Search size={18} />
          <input
            aria-label="Поиск чатов"
            placeholder="Поиск"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Очистить поиск"
              onClick={() => setSearch('')}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div className="chat-list-heading">
          <h1>Сообщения {unread > 0 && <span>{unread}</span>}</h1>
          <button
            className="icon-button"
            aria-label="Создать новый чат"
            onClick={() => setModal('new')}
          >
            <Plus size={19} />
          </button>
        </div>
        <nav className="chat-list" aria-label="Чаты">
          {chats.map((chat) => {
            const last = chat.messages.at(-1);
            return (
              <button
                className={`chat-item ${active?.id === chat.id ? 'selected' : ''}`}
                key={chat.id}
                onClick={() => selectChat(chat.id)}
                aria-current={active?.id === chat.id ? 'page' : undefined}
              >
                <Avatar chat={chat} />
                <span className="chat-item-content">
                  <span className="chat-item-top">
                    <strong>{chat.name}</strong>
                    <time>{last ? time(last.timestamp) : ''}</time>
                  </span>
                  <span className="chat-item-bottom">
                    <span>
                      {last
                        ? `${last.direction === 'out' ? 'Вы: ' : ''}${last.text}`
                        : 'Начните разговор'}
                    </span>
                    {chat.unread > 0 ? (
                      <b className="unread-badge">{chat.unread}</b>
                    ) : last?.direction === 'out' ? (
                      <MessageStatus status={last.status} />
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
          {chats.length === 0 && (
            <div className="empty-list">
              <MessageCircle size={30} strokeWidth={1.3} />
              <h3>{search ? 'Ничего не найдено' : 'Ваши чаты будут здесь'}</h3>
              <p>
                {search
                  ? 'Попробуйте другое имя или номер.'
                  : 'Начните разговор с тем, кто вам важен.'}
              </p>
              {!search && (
                <button className="text-button" onClick={() => setModal('new')}>
                  Создать первый чат <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          {demo && (
            <div className="demo-notice">
              <span /> Демоверсия{' '}
              <button onClick={logout}>
                Подключить аккаунт <ArrowRight size={13} />
              </button>
            </div>
          )}
          <button className="account-button" onClick={() => setModal('account')}>
            <span className="account-avatar">{demo ? 'Д' : 'Я'}</span>
            <span>
              <strong>{demo ? 'Демоаккаунт' : 'Мой аккаунт'}</strong>
              <small>
                <span className={`connection-dot ${connection.state}`} />
                {demo
                  ? 'Знакомство с интерфейсом'
                  : connection.state === 'connected'
                    ? 'GREEN-API подключён'
                    : connection.state === 'waiting'
                      ? 'Другая вкладка активна'
                      : 'Нет соединения'}
              </small>
            </span>
            <ChevronDown size={17} />
          </button>
          <div className="powered">
            Работает на{' '}
            <a href="https://green-api.com/max" target="_blank" rel="noreferrer">
              <span className="green-dot" /> GREEN-API <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </aside>
      <section
        className="chat-panel"
        aria-label={active ? `Чат с ${active.name}` : 'Область сообщений'}
      >
        {active ? (
          <>
            <header className="conversation-header">
              <button
                className="icon-button mobile-back"
                aria-label="Назад к чатам"
                onClick={() => selectChat(null)}
              >
                <ArrowLeft size={22} />
              </button>
              <Avatar chat={active} />
              <div className="contact-heading">
                <h2>{active.name}</h2>
                <span>
                  {formatPhone(active.phone)}
                  <i />
                  MAX
                </span>
              </div>
              <button
                className="icon-button"
                title="Информация о чате"
                aria-label="Информация о чате"
                onClick={() => setModal('info')}
              >
                <Info size={21} />
              </button>
            </header>
            {demo && (
              <div className="demo-top">
                <span>Демоверсия</span> Сообщения не отправляются в MAX
              </div>
            )}
            <div
              className="message-scroll"
              role="log"
              aria-label="Сообщения"
              aria-live="polite"
              aria-relevant="additions text"
            >
              <div className="messages">
                {active.messages.length === 0 && (
                  <div className="conversation-start">
                    <div className="empty-chat-symbol">
                      <MessageCircle size={32} />
                    </div>
                    <h2>Начните с «Привет»</h2>
                    <p>
                      Отправьте первое сообщение.
                      <br />
                      Ответ появится прямо здесь.
                    </p>
                  </div>
                )}
                {active.messages.map((message, index) => (
                  <div key={message.id} className="message-group">
                    {(index === 0 ||
                      new Date(message.timestamp).toDateString() !==
                        new Date(active.messages[index - 1].timestamp).toDateString()) && (
                      <div className="date-separator">
                        <span>{dayLabel(message.timestamp)}</span>
                      </div>
                    )}
                    <div className={`message-row ${message.direction}`}>
                      <div
                        className={`bubble ${['failed', 'uncertain'].includes(message.status) ? 'problem' : ''}`}
                      >
                        <p>{message.text}</p>
                        <div className="message-meta">
                          <time dateTime={new Date(message.timestamp).toISOString()}>
                            {time(message.timestamp)}
                          </time>
                          {message.direction === 'out' && <MessageStatus status={message.status} />}
                        </div>
                        {message.error && (
                          <div className="message-error">
                            <span>{message.error}</span>
                            {message.status === 'failed' && (
                              <button
                                disabled={sending.has(active.id)}
                                onClick={() => void sendMessage(active, message.text, message.id)}
                              >
                                Повторить отправку
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
            </div>
            {connection.state !== 'connected' && (
              <div className="connection-banner" role="status">
                <CircleAlert size={16} />
                <span>{connection.message}</span>
              </div>
            )}
            {notice && (
              <div className="connection-banner" role="status">
                {notice}
                <button
                  className="icon-button"
                  aria-label="Скрыть уведомление"
                  onClick={() => setNotice('')}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="composer-area">
              <form className="composer" onSubmit={submit}>
                <div className="emoji-wrap">
                  <button
                    type="button"
                    className="icon-button emoji-button"
                    aria-label="Добавить эмодзи"
                    aria-expanded={emojiOpen}
                    onClick={() => setEmojiOpen((value) => !value)}
                  >
                    <Smile size={23} />
                  </button>
                  {emojiOpen && (
                    <div className="emoji-picker">
                      {['🙂', '👋', '❤️', '👍', '😊', '🎉', '☀️', '🤝'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          aria-label={`Вставить ${emoji}`}
                          onClick={() => {
                            setDrafts((value) => ({ ...value, [active.id]: draft + emoji }));
                            setEmojiOpen(false);
                            textarea.current?.focus();
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <textarea
                  ref={textarea}
                  aria-label="Текст сообщения"
                  placeholder="Написать сообщение…"
                  rows={1}
                  value={draft}
                  onChange={(event) =>
                    setDrafts((value) => ({ ...value, [active.id]: event.target.value }))
                  }
                  onKeyDown={onKeyDown}
                />
                <button
                  className="send-button"
                  aria-label="Отправить сообщение"
                  disabled={
                    !draft.trim() ||
                    draft.length > 4000 ||
                    sending.has(active.id) ||
                    (!demo && connection.state === 'error')
                  }
                >
                  <Send size={20} />
                </button>
              </form>
              <div className="composer-hint">
                <span>
                  Enter — отправить <i /> Shift + Enter — новая строка
                </span>
                <span className={draft.length > 4000 ? 'over-limit' : ''}>
                  {draft.length > 3500 ? (
                    `${draft.length} / 4000`
                  ) : (
                    <>
                      <ShieldCheck size={12} /> Текстовые сообщения в MAX
                    </>
                  )}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="welcome-empty">
            <div className="welcome-orbit">
              <img src="/favicon.svg" alt="" />
              <span className="orbit-dot one" />
              <span className="orbit-dot two" />
            </div>
            <span className="eyebrow muted">НА СВЯЗИ С ВАЖНЫМИ</span>
            <h2>
              Ваш следующий разговор
              <br />
              начинается здесь
            </h2>
            <p>
              Выберите чат слева или создайте новый,
              <br />
              чтобы написать сообщение в MAX.
            </p>
            <button className="primary" onClick={() => setModal('new')}>
              <Plus size={18} /> Новый чат
            </button>
            <span className="welcome-footnote">
              <ShieldCheck size={14} /> Простое общение. Ничего лишнего.
            </span>
            {connection.state !== 'connected' && <p role="status">{connection.message}</p>}
          </div>
        )}
      </section>
      {modal === 'new' && <NewChat api={api} store={store} onClose={() => setModal(null)} />}
      {modal === 'account' && (
        <Modal title="Мой аккаунт" onClose={() => setModal(null)}>
          <div className="account-detail">
            <img src="/favicon.svg" alt="" />
            <strong>{demo ? 'Демонстрационный аккаунт' : 'MAX через GREEN-API'}</strong>
            <p>
              {demo
                ? 'Данные вымышлены. Подключите свой инстанс для реальной переписки.'
                : `ID инстанса: ${credentials?.idInstance}`}
            </p>
          </div>
          {!demo && (
            <div className="info-note">
              <ShieldCheck size={19} />
              <p>
                Токен хранится только в памяти. При выходе данные чатов удаляются из этой вкладки.
              </p>
            </div>
          )}
          <button className="secondary full-width logout-button" onClick={logout}>
            <LogOut size={17} />
            {demo ? 'Выйти и подключить аккаунт' : 'Выйти из аккаунта'}
          </button>
        </Modal>
      )}
      {modal === 'info' && active && (
        <Modal title="Информация о чате" onClose={() => setModal(null)}>
          <div className="account-detail">
            <Avatar chat={active} large />
            <strong>{active.name}</strong>
            <p>{formatPhone(active.phone)}</p>
          </div>
          <div className="chat-details">
            <span>
              Мессенджер<strong>MAX</strong>
            </span>
            <span>
              Сообщений<strong>{active.messages.length}</strong>
            </span>
            <span>
              Тип чата<strong>Личный</strong>
            </span>
          </div>
        </Modal>
      )}
    </main>
  );
}

function NewChat({
  api,
  store,
  onClose,
}: {
  api: GreenApi | null;
  store: ChatStore;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controller.current) return;
    const form = new FormData(event.currentTarget);
    let phone: string;
    try {
      phone = normalizePhone(String(form.get('phone')));
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    const existing = store.getSnapshot().chats.find((chat) => chat.phone === phone);
    if (existing) {
      store.select(existing.id);
      onClose();
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setError('');
    try {
      const id = api ? await api.resolvePhone(phone, abort.signal) : `demo-${phone}`;
      if (!abort.signal.aborted) {
        store.add(id, phone, String(form.get('name') ?? ''));
        onClose();
      }
    } catch (cause) {
      if (!abort.signal.aborted) setError(errorText(cause));
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setPending(false);
    }
  }
  return (
    <Modal title="Новый чат" onClose={onClose}>
      <p className="modal-description">Самое время написать. Введите номер собеседника в MAX.</p>
      <form className="new-chat-form" onSubmit={submit}>
        <label htmlFor="phone">Номер телефона</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          placeholder="+7 999 123-45-67"
          autoComplete="tel"
          autoFocus
          required
          disabled={pending}
        />
        <p className="field-help">С кодом страны, например +7 или +375.</p>
        <label htmlFor="contact-name">
          Имя <span>необязательно</span>
        </label>
        <input
          id="contact-name"
          name="name"
          placeholder="Как зовут собеседника?"
          maxLength={70}
          disabled={pending}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full-width" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle className="spin" size={17} /> Ищем в MAX…
            </>
          ) : (
            <>
              Начать разговор <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}
