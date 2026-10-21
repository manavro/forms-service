// Общие мелочи интерфейса: уведомления, копирование, даты, склонения.

import { h } from './dom.js';
import { FORM_STATUSES } from '/shared/fieldTypes.js';

// Всплывающее уведомление. Контейнер помечен aria-live,
// поэтому программы для незрячих тоже его зачитают.
export function toast(message, type = 'info') {
  let container = document.getElementById('toasts');
  if (!container) {
    container = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
    document.body.append(container);
  }
  const el = h('div', { class: ['toast', `toast-${type}`], role: type === 'error' ? 'alert' : 'status' }, message);
  container.append(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3000);
}

// Копирует текст в буфер обмена. navigator.clipboard работает только на
// localhost и по HTTPS, поэтому есть запасной способ для остальных случаев.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { value: text, readOnly: true, class: 'visually-hidden' });
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso) {
  return iso ? dateFormat.format(new Date(iso)) : '';
}

// Склонения — в общем с сервером модуле; здесь реэкспорт, чтобы страницы брали всё из ui.js.
export { countLabel, plural } from '/shared/plural.js';

export function statusBadge(status) {
  return h('span', { class: ['badge', `badge-${status}`] }, FORM_STATUSES[status] ?? status);
}

export function publicFormUrl(slug) {
  return `${location.origin}/f/${slug}`;
}
