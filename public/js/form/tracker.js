// Сбор событий заполнения формы для аналитики.
//
// Что отправляется: тип события, id поля и сколько миллисекунд прошло с открытия
// страницы. Что НЕ отправляется: введённый текст и выбранные варианты.
// Номер сессии случайный и живёт только в этой вкладке.
//
// События копятся и уходят пачкой раз в несколько секунд — так меньше запросов.
// Когда студент уходит со страницы или сворачивает вкладку, оставшиеся события
// отправляются через navigator.sendBeacon: браузер доставит их, даже если страница уже закрывается.
//
// Аналитика никогда не должна мешать заполнению: все ошибки отправки молча игнорируются.

const FLUSH_DELAY_MS = 3000;
const MAX_BATCH = 50;

export function createTracker({ url, sessionId }) {
  const startedAt = performance.now();
  const filled = new Set();
  let queue = [];
  let timer = null;
  let lastFocusedId = null;
  let lastType = null;
  let stopped = false;

  const elapsed = () => Math.round(performance.now() - startedAt);

  function push(event) {
    if (stopped) return;
    lastType = event.type;
    queue.push({ ...event, t: elapsed() });
    if (queue.length >= MAX_BATCH) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
  }

  function flush({ beacon = false } = {}) {
    clearTimeout(timer);
    timer = null;
    while (queue.length > 0) {
      const body = JSON.stringify({ sessionId, events: queue.splice(0, MAX_BATCH) });
      try {
        if (beacon && navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        } else {
          // keepalive — запрос не оборвётся, даже если страницу закроют прямо сейчас.
          fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
        }
      } catch {
        // Аналитика не важнее формы — просто теряем эти события.
      }
    }
  }

  function leave() {
    // При закрытии страницы браузер присылает и visibilitychange, и pagehide — второй «уход» не нужен.
    if (lastType !== 'leave') push({ type: 'leave' });
    // После возвращения на вкладку переход к тому же полю — уже новый отрезок времени.
    lastFocusedId = null;
    flush({ beacon: true });
  }

  // Мобильные браузеры не всегда сообщают о закрытии страницы (pagehide),
  // зато надёжно сообщают, что вкладка скрыта, поэтому слушаем оба события.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
  });
  window.addEventListener('pagehide', leave);

  return {
    view() {
      push({ type: 'view' });
      flush();
    },
    focus(field) {
      // Переходы внутри одного поля (например, между вариантами ответа) — не новое событие.
      if (lastFocusedId === field.id) return;
      lastFocusedId = field.id;
      push({ type: 'focus', fieldId: field.id });
    },
    change(field, value) {
      const empty = value === undefined || value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);
      if (empty || filled.has(field.id)) return;
      filled.add(field.id);
      push({ type: 'fill', fieldId: field.id });
    },
    error(field) {
      push({ type: 'error', fieldId: field.id });
    },
    elapsed,
    // Перед отправкой ответа досылаем накопленное, после — перестаём следить.
    flush: () => flush(),
    stop() {
      flush();
      stopped = true;
    },
  };
}
