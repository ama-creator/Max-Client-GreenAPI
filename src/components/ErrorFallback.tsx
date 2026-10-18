export function ErrorFallback() {
  return (
    <main className="fatal" role="alert">
      <img src="/favicon.svg" alt="" width="56" height="56" />
      <h1>Не удалось открыть чат</h1>
      <p>Обновите страницу, чтобы восстановить работу.</p>
      <button className="primary" onClick={() => window.location.reload()}>
        Обновить страницу
      </button>
    </main>
  );
}
