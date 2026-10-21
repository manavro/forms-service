// Публичная страница формы: /f/<код>.

import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { newId } from '../ids.js';
import { clearDraft, loadDraft, saveDraft } from './draft.js';
import { createFormView } from './formView.js';
import { createTracker } from './tracker.js';

const slug = decodeURIComponent(location.pathname.split('/').pop());
const root = document.getElementById('app');
const apiUrl = `/api/public/forms/${encodeURIComponent(slug)}`;

// Номер этой попытки заполнения. Если ответ отправится дважды (двойной клик,
// повтор после сбоя сети), сервер по этому номеру поймёт, что это тот же ответ.
// Он же — номер сессии в аналитике.
const submissionId = newId(12);

load();

async function load() {
  let form;
  try {
    ({ form } = await api('GET', apiUrl));
  } catch (err) {
    if (err.status === 404) {
      clearDraft(slug);
      showMessage('Форма не найдена', 'Проверьте ссылку: возможно, в ней опечатка, или форму уже удалили.');
    } else if (err.status === 410) {
      clearDraft(slug);
      showClosed(err.data?.title);
    } else {
      showMessage('Не удалось загрузить форму', err.message, { retry: true });
    }
    return;
  }

  document.title = form.title;

  // Аналитика: тот же номер, что и у ответа, — так отправленный ответ связывается с его сессией.
  const tracker = createTracker({ url: `${apiUrl}/events`, sessionId: submissionId });
  tracker.view();

  // Черновик: если студент уже начинал заполнять форму в этом браузере — возвращаем его ответы.
  const draft = loadDraft(slug);
  let saveTimer = null;
  let view;
  const saveNow = () => {
    clearTimeout(saveTimer);
    if (view) saveDraft(slug, view.getAnswers());
  };

  view = createFormView(form, {
    initialAnswers: draft?.answers,
    notice: draft ? renderDraftNotice(draft) : null,
    hooks: {
      onFieldFocus: (field) => tracker.focus(field),
      onFieldChange: (field, value) => {
        // Safari не переводит фокус на переключатели при клике — отмечаем переход к полю и здесь.
        tracker.focus(field);
        tracker.change(field, value);
        // Сохраняем не на каждое нажатие клавиши, а через полсекунды после последнего.
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 500);
      },
      onFieldError: (field) => tracker.error(field),
    },
    onSubmit: async ({ answers, website }) => {
      tracker.flush();
      try {
        await api('POST', `${apiUrl}/responses`, { answers, website, submissionId, elapsed: tracker.elapsed() });
      } catch (err) {
        if (err.status === 410) {
          finish();
          showClosed(form.title);
          return;
        }
        throw err;
      }
      finish();
      showThanks(form.title);
    },
  });
  mount(root, view.element);

  // Вкладку закрывают раньше, чем сработал таймер, — сохраняем сразу.
  window.addEventListener('pagehide', saveNow);

  // Ответ отправлен (или приём закрыт): черновик больше не нужен.
  function finish() {
    tracker.stop();
    window.removeEventListener('pagehide', saveNow);
    clearTimeout(saveTimer);
    clearDraft(slug);
  }
}

function renderDraftNotice(draft) {
  const when = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(
    new Date(draft.savedAt),
  );
  return h(
    'div',
    { class: 'pf-card pf-restored', role: 'status' },
    h('p', null, `Мы вернули ответы, которые вы начали заполнять ${when}. Они хранятся только в этом браузере.`),
    h(
      'button',
      {
        class: 'btn btn-sm',
        type: 'button',
        onclick: () => {
          if (!confirm('Стереть сохранённые ответы и начать заново?')) return;
          clearDraft(slug);
          location.reload();
        },
      },
      'Начать заново',
    ),
  );
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
