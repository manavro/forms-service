// Публичная страница формы: /f/<код>.

import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { newId } from '../ids.js';
import { createFormView } from './formView.js';

const slug = decodeURIComponent(location.pathname.split('/').pop());
const root = document.getElementById('app');
const apiUrl = `/api/public/forms/${encodeURIComponent(slug)}`;

// Номер этой попытки заполнения. Если ответ отправится дважды (двойной клик,
// повтор после сбоя сети), сервер по этому номеру поймёт, что это тот же ответ.
const submissionId = newId(12);

load();

async function load() {
  let form;
  try {
    ({ form } = await api('GET', apiUrl));
  } catch (err) {
    if (err.status === 404) {
      showMessage('Форма не найдена', 'Проверьте ссылку: возможно, в ней опечатка, или форму уже удалили.');
    } else if (err.status === 410) {
      showClosed(err.data?.title);
    } else {
      showMessage('Не удалось загрузить форму', err.message, { retry: true });
    }
    return;
  }

  document.title = form.title;
  const view = createFormView(form, {
    onSubmit: async ({ answers, website }) => {
      try {
        await api('POST', `${apiUrl}/responses`, { answers, website, submissionId });
      } catch (err) {
        if (err.status === 410) {
          showClosed(form.title);
          return;
        }
        throw err;
      }
      showThanks(form.title);
    },
  });
  mount(root, view.element);
}

function showThanks(title) {
  showMessage('Спасибо! Ответ отправлен', 'Можно закрыть эту страницу.', { success: true, subtitle: title });
}

function showClosed(title) {
  showMessage('Приём ответов завершён', 'Организатор больше не принимает ответы на эту форму.', { subtitle: title });
}

function showMessage(title, text, { success = false, retry = false, subtitle } = {}) {
  document.title = subtitle ? `${title} · ${subtitle}` : title;
  mount(
    root,
    h(
      'div',
      { class: 'pf' },
      h(
        'div',
        { class: ['pf-card', 'pf-message', success && 'is-success'], role: 'status' },
        success && h('div', { class: 'pf-message-icon', 'aria-hidden': 'true' }, '✓'),
        subtitle && h('p', { class: 'pf-message-subtitle' }, subtitle),
        h('h1', { class: 'pf-title' }, title),
        h('p', { class: 'muted' }, text),
        retry && h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Попробовать ещё раз'),
      ),
    ),
  );
  window.scrollTo(0, 0);
}
