// Страница ответов на форму: таблица, поиск, просмотр одного ответа, выгрузка в CSV.

import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { copyText, countLabel, formatDate, publicFormUrl, statusBadge, toast } from '../ui.js';
import { formTabs } from './formTabs.js';
import { formatAnswer } from '/shared/answerFormat.js';

const formId = decodeURIComponent(location.pathname.split('/')[3]);
const apiUrl = `/api/forms/${encodeURIComponent(formId)}/responses`;
const root = document.getElementById('responses');

const state = {
  form: null,
  columns: [], // вопросы: { fieldId, label, type, deleted }
  rows: [], // ответы, свежие сверху: { id, number, submittedAt, answers: { [fieldId]: answer } }
  query: '',
  newestFirst: true,
};

let tableHost;
let countEl;

load();

async function load() {
  try {
    const data = await api('GET', apiUrl);
    state.form = data.form;
    state.columns = data.columns;
    state.rows = data.rows;
  } catch (err) {
    const notFound = err.status === 404;
    mount(
      root,
      h(
        'div',
        { class: 'card empty' },
        h('h1', null, notFound ? 'Форма не найдена' : 'Не удалось загрузить ответы'),
        h('p', { class: 'muted' }, notFound ? 'Возможно, её удалили.' : err.message),
        h('a', { class: 'btn', href: '/admin' }, 'К списку форм'),
      ),
    );
    return;
  }
  document.title = `Ответы · ${state.form.title}`;
  renderPage();
}

// ---------- Страница ----------

function renderPage() {
  const { form, rows } = state;
  tableHost = h('div');
  countEl = h('p', { class: 'muted table-count', role: 'status' });

  mount(
    root,
    h('a', { class: 'back-link', href: '/admin' }, '← Все формы'),
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, form.title), statusBadge(form.status)),
    formTabs(formId, 'responses', { responses: rows.length }),
    rows.length === 0 ? renderEmpty() : [renderToolbar(), countEl, tableHost],
  );
  if (rows.length > 0) renderTable();
}

function renderEmpty() {
  const { form } = state;
  let hint;
  if (form.status === 'draft') {
    hint = [
      h('p', { class: 'muted' }, 'Форма ещё не опубликована. Опубликуйте её в конструкторе — появится ссылка для студентов.'),
      h('a', { class: 'btn btn-primary', href: `/admin/forms/${encodeURIComponent(formId)}` }, 'Открыть конструктор'),
    ];
  } else if (form.status === 'closed') {
    hint = h('p', { class: 'muted' }, 'Приём ответов закрыт. Его можно снова открыть в конструкторе.');
  } else {
    const url = publicFormUrl(form.slug);
    hint = [
      h('p', { class: 'muted' }, 'Отправьте студентам ссылку на форму — ответы появятся здесь.'),
      h(
        'div',
        { class: 'link-box empty-link' },
        h('input', { class: 'input', value: url, readOnly: true, 'aria-label': 'Ссылка для студентов' }),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              const ok = await copyText(url);
              toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку', ok ? 'success' : 'error');
            },
          },
          'Скопировать',
        ),
      ),
    ];
  }
  return h('div', { class: 'card empty' }, h('h2', null, 'Пока нет ни одного ответа'), hint);
}

function renderToolbar() {
  return h(
    'div',
    { class: 'toolbar' },
    h('input', {
      type: 'search',
      class: 'input search-input',
      placeholder: 'Поиск по ответам',
      'aria-label': 'Поиск по ответам',
      value: state.query,
      oninput: (event) => {
        state.query = event.target.value;
        renderTable();
      },
    }),
    h(
      'select',
      {
        class: 'select sort-select',
        'aria-label': 'Порядок ответов',
        value: state.newestFirst ? 'new' : 'old',
        onchange: (event) => {
          state.newestFirst = event.target.value === 'new';
          renderTable();
        },
      },
      h('option', { value: 'new' }, 'Сначала новые'),
      h('option', { value: 'old' }, 'Сначала старые'),
    ),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', type: 'button', onclick: () => refresh() }, 'Обновить'),
    // Атрибут download и заголовок Content-Disposition говорят браузеру скачать файл, а не открыть его.
    h('a', { class: 'btn btn-primary', href: `${apiUrl}/export`, download: '' }, 'Скачать CSV для Excel'),
  );
}

// Ответы с учётом поиска и сортировки.
function visibleRows() {
  const query = state.query.trim().toLocaleLowerCase('ru');
  let rows = state.rows;
  if (query) {
    rows = rows.filter((row) => {
      const texts = [`№ ${row.number}`, formatDate(row.submittedAt), ...state.columns.map((c) => formatAnswer(row.answers[c.fieldId]))];
      return texts.some((text) => text.toLocaleLowerCase('ru').includes(query));
    });
  }
  return state.newestFirst ? rows : [...rows].reverse();
}

function renderTable() {
  const rows = visibleRows();
  const total = state.rows.length;
  countEl.textContent = state.query.trim()
    ? `Найдено: ${rows.length} из ${total}`
    : `Всего ${countLabel(total, ['ответ', 'ответа', 'ответов'])}. Нажмите на строку, чтобы открыть ответ целиком.`;

  if (rows.length === 0) {
    mount(tableHost, h('div', { class: 'card empty' }, h('p', { class: 'muted' }, 'По этому запросу ничего не найдено.')));
    return;
  }

  mount(
    tableHost,
    // Прокручиваемая область должна быть доступна с клавиатуры, поэтому tabindex и подпись.
    h(
      'div',
      { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Таблица ответов' },
      h(
        'table',
        { class: 'responses-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col' }, h('div', { class: 'th-inner' }, '№')),
            h('th', { scope: 'col' }, h('div', { class: 'th-inner' }, 'Отправлен')),
            state.columns.map((column) =>
              h(
                'th',
                { scope: 'col' },
                h(
                  'div',
                  { class: 'th-inner' },
                  column.label || 'Без названия',
                  column.deleted && h('span', { class: 'col-deleted' }, ' (вопрос удалён)'),
                ),
              ),
            ),
          ),
        ),
        h(
          'tbody',
          null,
          rows.map((row) =>
            h(
              'tr',
              {
                onclick: (event) => {
                  if (!event.target.closest('button')) openResponse(row.id);
                },
              },
              h(
                'td',
                null,
                h(
                  'button',
                  {
                    class: 'link-button',
                    type: 'button',
                    'aria-label': `Открыть ответ № ${row.number}`,
                    onclick: () => openResponse(row.id),
                  },
                  `№ ${row.number}`,
                ),
              ),
              h('td', { class: 'nowrap' }, formatDate(row.submittedAt)),
              state.columns.map((column) => {
                const text = formatAnswer(row.answers[column.fieldId]);
                return h(
                  'td',
                  null,
                  text ? h('div', { class: 'cell-clamp', title: text.length > 80 ? text : undefined }, text) : h('span', { class: 'muted' }, '—'),
                );
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

async function refresh({ quiet = false } = {}) {
  try {
    const data = await api('GET', apiUrl);
    state.form = data.form;
    state.columns = data.columns;
    state.rows = data.rows;
    renderPage();
    if (!quiet) toast(`Обновлено: ${countLabel(state.rows.length, ['ответ', 'ответа', 'ответов'])}`);
  } catch (err) {
    toast(`Не удалось обновить. ${err.message}`, 'error');
  }
}

// ---------- Один ответ ----------

function openResponse(responseId) {
  const list = visibleRows();
  let index = list.findIndex((row) => row.id === responseId);
  if (index === -1) return;

  const titleEl = h('h2', { class: 'modal-title', id: 'response-title' });
  const body = h('div', { class: 'modal-body' });
  const prevButton = h('button', { class: 'btn', type: 'button', onclick: () => go(-1) }, '← Предыдущий');
  const nextButton = h('button', { class: 'btn', type: 'button', onclick: () => go(1) }, 'Следующий →');
  const deleteButton = h('button', { class: 'btn btn-danger', type: 'button', onclick: removeCurrent }, 'Удалить ответ');

  const dialog = h(
    'dialog',
    {
      class: 'modal',
      'aria-labelledby': 'response-title',
      onclose: () => dialog.remove(),
      onkeydown: (event) => {
        // Стрелки влево/вправо листают ответы.
        if (event.key === 'ArrowLeft') go(-1);
        if (event.key === 'ArrowRight') go(1);
      },
    },
    h(
      'div',
      { class: 'modal-head' },
      titleEl,
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Закрыть', onclick: () => dialog.close() }, '✕'),
    ),
    body,
    h('div', { class: 'modal-foot' }, prevButton, nextButton, h('span', { class: 'spacer' }), deleteButton),
  );

  function show() {
    const row = list[index];
    titleEl.textContent = `Ответ № ${row.number}`;
    mount(
      body,
      h('p', { class: 'muted' }, `Отправлен ${formatDate(row.submittedAt)}`),
      h('dl', { class: 'answer-list' }, state.columns.map((column) => renderAnswer(column, row.answers[column.fieldId]))),
    );
    body.scrollTop = 0;
    prevButton.disabled = index === 0;
    nextButton.disabled = index === list.length - 1;
  }

  function go(delta) {
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    index = next;
    show();
  }

  async function removeCurrent() {
    const row = list[index];
    if (!confirm(`Удалить ответ № ${row.number}?\n\nЭто действие нельзя отменить.`)) return;
    deleteButton.disabled = true;
    try {
      await api('DELETE', `${apiUrl}/${encodeURIComponent(row.id)}`);
    } catch (err) {
      deleteButton.disabled = false;
      alert(`Не удалось удалить ответ. ${err.message}`);
      return;
    }
    dialog.close();
    await refresh({ quiet: true });
    toast(`Ответ № ${row.number} удалён`);
  }

  document.body.append(dialog);
  show();
  dialog.showModal();
}

function renderAnswer(column, answer) {
  const title = column.label || 'Без названия';
  const notes = [];
  if (column.deleted) notes.push('вопрос удалён из формы');
  else if (answer && answer.label !== column.label) notes.push(`в момент ответа вопрос звучал так: «${answer.label}»`);

  let value;
  if (!answer) {
    value = h('span', { class: 'muted' }, 'Этого вопроса ещё не было в форме, когда отправили ответ');
  } else {
    const text = formatAnswer(answer);
    value = text ? h('span', { class: 'answer-text' }, text) : h('span', { class: 'muted' }, 'Нет ответа');
  }

  return [
    h('dt', null, title, notes.length > 0 && h('span', { class: 'answer-note' }, ` (${notes.join(', ')})`)),
    h('dd', null, value),
  ];
}
