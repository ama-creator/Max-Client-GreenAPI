import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import { credentialsSchema, errorText, GreenApi, type Credentials } from '../lib/api';

export function Login({
  onConnect,
  onDemo,
}: {
  onConnect: (credentials: Credentials) => void;
  onDemo: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controller.current && !controller.current.signal.aborted) return;
    setError('');
    const form = new FormData(event.currentTarget);
    const result = credentialsSchema.safeParse(
      Object.fromEntries([...form].map(([key, value]) => [key, String(value).trim()])),
    );
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setPending(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      await new GreenApi(result.data).connect(abort.signal);
      if (!abort.signal.aborted) onConnect(result.data);
    } catch (cause) {
      if (!abort.signal.aborted) setError(errorText(cause));
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setPending(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="MAX через GREEN-API">
        <a className="brand" href="/" aria-label="MAX — на главную">
          <img src="/favicon.svg" alt="" />
          <span>MAX</span>
          <span className="brand-divider" />
          <span className="integration-label">через GREEN-API</span>
        </a>
        <div className="story-content">
          <span className="eyebrow">
            <span /> ПРОСТО БЫТЬ НА СВЯЗИ
          </span>
          <h1>
            Разговор начинается
            <br />с одного <span>«Привет».</span>
          </h1>
          <p>
            Ваши сообщения в MAX.
            <br />
            Знакомый чат, только самое нужное.
          </p>
          <div className="conversation-illustration" aria-hidden="true">
            <div className="illustration-glow" />
            <div className="floating-message first">
              <span className="mini-avatar">А</span>
              <div>
                Привет! Ты на связи? <span className="wave">👋</span>
                <small>12:40</small>
              </div>
            </div>
            <div className="floating-message second">
              <div>
                Да, я здесь!
                <small>
                  12:41 <Check size={13} />
                  <Check size={13} />
                </small>
              </div>
              <span className="mini-avatar blue">Я</span>
            </div>
            <div className="floating-message third">
              <span className="mini-avatar">А</span>
              <div className="typing-dots">
                <i />
                <i />
                <i />
              </div>
            </div>
            <span className="illustration-spark spark-one">✦</span>
            <span className="illustration-spark spark-two">✦</span>
          </div>
        </div>
        <div className="story-footer">
          <ShieldCheck size={17} /> Прямое подключение к GREEN-API
          <span>Только текст. Только общение.</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="form-symbol">
            <MessageCircle size={26} strokeWidth={1.7} />
          </div>
          <span className="eyebrow muted">ВАШ ЛИЧНЫЙ ЧАТ</span>
          <h2>Добро пожаловать</h2>
          <p className="form-intro">Подключите свой аккаунт и начните разговор.</p>
          <form onSubmit={submit} className="login-form">
            <label htmlFor="instance">
              ID инстанса <span>idInstance</span>
            </label>
            <div className="input-with-icon">
              <KeyRound size={18} />
              <input
                id="instance"
                name="idInstance"
                placeholder="Например, 3100000001"
                inputMode="numeric"
                autoComplete="off"
                required
                disabled={pending}
              />
            </div>
            <label htmlFor="token">
              API-токен <span>apiTokenInstance</span>
            </label>
            <div className="input-with-icon">
              <LockKeyhole size={18} />
              <input
                id="token"
                name="apiTokenInstance"
                type={visible ? 'text' : 'password'}
                placeholder="Ваш ключ доступа"
                autoComplete="off"
                required
                disabled={pending}
              />
              <button
                type="button"
                className="icon-button"
                onClick={() => setVisible((value) => !value)}
                aria-label={visible ? 'Скрыть токен' : 'Показать токен'}
                aria-pressed={visible}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <label htmlFor="api-url">
              Адрес API <span>apiUrl</span>
            </label>
            <input
              id="api-url"
              name="apiUrl"
              type="url"
              placeholder="https://3100.api.green-api.com"
              autoComplete="url"
              required
              disabled={pending}
            />
            <p className="field-help">Скопируйте apiUrl из настроек своего инстанса.</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary connect-button" disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="spin" size={18} /> Подключаемся…
                </>
              ) : (
                <>
                  Подключиться к MAX <ArrowRight size={18} />
                </>
              )}
            </button>
            <p className="privacy-note">
              <LockKeyhole size={13} /> Токен хранится только до закрытия страницы
            </p>
          </form>
          <div className="login-divider">
            <span>или познакомьтесь с интерфейсом</span>
          </div>
          <button className="secondary demo-button" onClick={onDemo} disabled={pending}>
            Открыть демоверсию <ArrowRight size={16} />
          </button>
          <details className="setup-help">
            <summary>Где взять данные для подключения?</summary>
            <p>
              Создайте инстанс MAX в{' '}
              <a href="https://console.green-api.com" target="_blank" rel="noreferrer">
                личном кабинете GREEN-API <ExternalLink size={12} />
              </a>{' '}
              и авторизуйте его по QR-коду. Скопируйте idInstance, apiTokenInstance и apiUrl.
            </p>
            <p>
              В настройках очистите Webhook URL и включите входящие уведомления. Для статусов
              доставки включите исходящие уведомления. Настройки применяются несколько минут.
            </p>
          </details>
        </div>
        <footer className="login-footer">
          Работает на{' '}
          <a href="https://green-api.com/max" target="_blank" rel="noreferrer">
            <span className="green-dot" /> GREEN-API <ExternalLink size={12} />
          </a>
        </footer>
      </section>
    </main>
  );
}
