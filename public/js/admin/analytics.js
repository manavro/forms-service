// Страница аналитики формы: где и почему студенты бросают заполнение.
//
// Все цифры считает сервер (src/analytics/computeAnalytics.js), страница их только показывает.
// Графики — обычные HTML-полосы: у каждого значения есть подпись-число,
// поэтому ничего не нужно угадывать по длине полосы или цвету.

import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { countLabel, statusBadge, toast } from '../ui.js';
import { formTabs } from './formTabs.js';
import { FIELD_TYPES } from '/shared/fieldTypes.js';

const formId = decodeURIComponent(location.pathname.split('/')[3]);
const apiUrl = `/api/forms/${encodeURIComponent(formId)}/analytics`;
const root = document.getElementById('analytics');

let days = null; // null — за всё время
let content; // область с цифрами — перерисовывается при смене периода

load();

async function load() {
  let data;
  try {
    data = await api('GET', apiUrl);
  } catch (err) {
    const notFound = err.status === 404;
    mount(
      root,
      h(
        'div',
        { class: 'card empty' },
        h('h1', null, notFound ? 'Форма не найдена' : 'Не удалось загрузить аналитику'),
        h('p', { class: 'muted' }, notFound ? 'Возможно, её удалили.' : err.message),
        h('a', { class: 'btn', href: '/admin' }, 'К списку форм'),
      ),
    );
    return;
  }

  document.title = `Аналитика · ${data.form.title}`;
  content = h('div', { class: 'stack' });
  mount(
    root,
    h('a', { class: 'back-link', href: '/admin' }, '← Все формы'),
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, data.form.title), statusBadge(data.form.status)),
    formTabs(formId, 'analytics'),
    renderFilters(),
    content,
  );
  renderReport(data);
}

// Фильтры — одной строкой над всем, что они меняют.
function renderFilters() {
  return h(
    'div',
    { class: 'toolbar' },
    h('label', { class: 'visually-hidden', for: 'period' }, 'Период'),
    h(
      'select',
      {
        id: 'period',
        class: 'select sort-select',
        value: days === null ? 'all' : String(days),
        onchange: (event) => {
          days = event.target.value === 'all' ? null : Number(event.target.value);
          refresh();
        },
      },
      h('option', { value: 'all' }, 'За всё время'),
      h('option', { value: '30' }, 'За 30 дней'),
      h('option', { value: '7' }, 'За 7 дней'),
    ),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', type: 'button', onclick: () => refresh() }, 'Обновить'),
    h('button', { class: 'btn btn-danger', type: 'button', onclick: resetAnalytics }, 'Сбросить аналитику'),
  );
}

async function refresh() {
  // Пока данные загружаются, показываем прежние цифры приглушёнными — без мигания и прыжков.
  content.classList.add('is-loading');
  try {
    renderReport(await api('GET', days ? `${apiUrl}?days=${days}` : apiUrl));
  } catch (err) {
    toast(`Не удалось обновить. ${err.message}`, 'error');
  } finally {
    content.classList.remove('is-loading');
  }
}

async function resetAnalytics() {
  const ok = confirm(
    'Сбросить аналитику этой формы?\n\nУдалятся все данные о заполнении (воронка, время, ошибки). Ответы студентов останутся. Это удобно после собственных тестовых заполнений.',
  );
  if (!ok) return;
  try {
    await api('DELETE', apiUrl);
    toast('Аналитика сброшена');
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Отчёт ----------

function renderReport(data) {
  const { totals } = data;
  if (totals.views === 0) {
    mount(
      content,
      h(
        'div',
        { class: 'card empty' },
        h('h2', null, days ? 'За этот период данных нет' : 'Пока нет данных'),
        h(
          'p',
          { class: 'muted' },
          'Данные появятся, когда студенты начнут открывать форму по ссылке. Предпросмотр в конструкторе не учитывается.',
        ),
      ),
    );
    return;
  }

  mount(content, renderTiles(totals), renderInsights(data.insights), renderFunnel(data.funnel), renderFields(data.fields, totals), renderMethod());
}

// Главные цифры — плитками, а не графиком: это несколько отдельных чисел.
function renderTiles(totals) {
  const tile = (label, value, note) =>
    h('div', { class: 'card stat' }, h('p', { class: 'stat-label' }, label), h('p', { class: 'stat-value' }, String(value)), note && h('p', { class: 'stat-note' }, note));

  return h(
    'section',
    { class: 'stats', 'aria-label': 'Главные цифры' },
    tile('Открыли форму', totals.views),
    tile('Начали заполнять', totals.started, `${percent(totals.started, totals.views)} открывших`),
    tile('Отправили', totals.submitted, `${percent(totals.submitted, totals.views)} открывших`),
    tile('Бросили', totals.abandoned, totals.started ? `${percent(totals.abandoned, totals.started)} начавших` : null),
    tile('Заполняют сейчас', totals.inProgress, 'активны последние 30 минут'),
  );
}

function renderInsights(insights) {
  const icons = { warning: '⚠', info: 'ℹ', success: '✓' };
  const titles = { warning: 'Проблема', info: 'Наблюдение', success: 'Всё хорошо' };
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'insights-title' },
    h('h2', { id: 'insights-title' }, 'Что можно улучшить'),
    h(
      'ul',
      { class: 'insights' },
      insights.map((insight) =>
        h(
          'li',
          { class: ['insight', `insight-${insight.level}`] },
          // Значок дублируется текстом для программ чтения с экрана: смысл не передаётся только цветом.
          h('span', { class: 'insight-icon', 'aria-hidden': 'true' }, icons[insight.level]),
          h('span', { class: 'visually-hidden' }, `${titles[insight.level]}: `),
          h('span', null, insight.text),
        ),
      ),
    ),
  );
}

// Воронка: одна полоса на шаг, длина — доля от открывших, число — на конце полосы.
function renderFunnel(funnel) {
  const base = funnel[0].count;
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'funnel-title' },
    h('h2', { id: 'funnel-title' }, 'Воронка'),
    h(
      'ol',
      { class: 'funnel' },
      funnel.map((step, i) => {
        const previous = funnel[i - 1];
        const lost = previous ? previous.count - step.count : 0;
        return h(
          'li',
          { class: 'funnel-step' },
          previous &&
            lost > 0 &&
            h('p', { class: 'funnel-loss' }, `↓ ушли ${lost} (${percent(lost, previous.count)})`),
          h('div', { class: 'funnel-label' }, step.label),
          bar(step.count, base, `${step.count} · ${percent(step.count, base)}`),
        );
      }),
    ),
  );
}

function renderFields(fields, totals) {
  if (fields.length === 0) {
    return h('section', { class: 'card' }, h('h2', null, 'По вопросам'), h('p', { class: 'muted' }, 'В форме нет вопросов.'));
  }
  const maxDropped = Math.max(...fields.map((f) => f.droppedHere));

  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'fields-title' },
    h('h2', { id: 'fields-title' }, 'По вопросам'),
    h(
      'p',
      { class: 'muted small' },
      'Сколько студентов дошли до каждого вопроса, на каком бросили форму, где ошибались и сколько времени тратили.',
    ),
    h(
      'div',
      { class: 'table-wrap table-wrap-plain', tabindex: '0', role: 'region', 'aria-label': 'Статистика по вопросам' },
      h(
        'table',
        { class: 'analytics-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col' }, '№'),
            h('th', { scope: 'col' }, 'Вопрос'),
            h('th', { scope: 'col', class: 'col-bar' }, 'Дошли до вопроса'),
            h('th', { scope: 'col', class: 'num' }, 'Бросили на нём'),
            h('th', { scope: 'col', class: 'num' }, 'Видели ошибку'),
            h('th', { scope: 'col', class: 'num' }, 'Время (медиана)'),
          ),
        ),
        h(
          'tbody',
          null,
          fields.map((field, i) => {
            const isTopDrop = maxDropped > 0 && field.droppedHere === maxDropped;
            return h(
              'tr',
              { class: isTopDrop ? 'is-top-drop' : null },
              h('td', { class: 'muted' }, String(i + 1)),
              h(
                'td',
                null,
                h('div', { class: 'q-label' }, field.label || 'Без названия', field.required && h('span', { class: 'muted' }, ' *')),
                h('div', { class: 'muted small' }, FIELD_TYPES[field.type]?.title ?? field.type),
                isTopDrop && h('span', { class: 'drop-flag' }, '⚠ чаще всего уходят здесь'),
              ),
              h('td', { class: 'col-bar' }, bar(field.reached, totals.started, `${field.reached} · ${percent(field.reached, totals.started)}`)),
              h('td', { class: 'num' }, String(field.droppedHere)),
              h('td', { class: 'num' }, field.errorSessions > 0 ? `${field.errorSessions} · ${percent(field.errorSessions, field.reached)}` : '0'),
              h('td', { class: 'num' }, formatDuration(field.medianSeconds)),
            );
          }),
        ),
      ),
    ),
    h('p', { class: 'muted small' }, `«Дошли до вопроса» — доля от ${countLabel(totals.started, ['начавшего', 'начавших', 'начавших'])} заполнять.`),
  );
}

function renderMethod() {
  return h(
    'details',
    { class: 'card method' },
    h('summary', null, 'Как считаются цифры'),
    h(
      'ul',
      null,
      h('li', null, 'Одно открытие формы в браузере — одна сессия. Если студент открыл форму дважды, это две сессии.'),
      h('li', null, '«Начали заполнять» — перешли хотя бы к одному вопросу.'),
      h('li', null, '«Бросили» — начали, не отправили и ничего не делали больше 30 минут. Кто был активен недавно, считается «заполняют сейчас».'),
      h('li', null, '«Бросили на вопросе» — вопрос, с которым студент работал последним перед уходом.'),
      h('li', null, '«Время» — медиана: половина студентов тратит меньше, половина больше. Так одна забытая открытой вкладка не искажает цифру.'),
      h('li', null, 'Сами ответы в аналитику не попадают: записывается только факт перехода к вопросу, ввода и ошибки. Cookie и IP-адреса не используются.'),
      h('li', null, 'Если удалить тестовый ответ во вкладке «Ответы», вместе с ним из аналитики удалится и его сессия.'),
    ),
  );
}

// ---------- Мелочи ----------

// Горизонтальная полоса со значением на конце. Длина — value / max.
function bar(value, max, label) {
  const share = max > 0 ? value / max : 0;
  const fill = h('span', { class: 'bar-fill' });
  // Ширину задаём через CSSOM (style.width), а не атрибутом style — это разрешено политикой CSP.
  fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  return h(
    'div',
    { class: 'bar', title: label },
    h('span', { class: 'bar-track' }, fill),
    h('span', { class: 'bar-value' }, label),
  );
}

function percent(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} мин ${rest} с` : `${minutes} мин`;
}
